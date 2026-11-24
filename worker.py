import base64, os, re, time
from decimal import Decimal, InvalidOperation
from datetime import datetime
from zoneinfo import ZoneInfo
import cv2
import numpy as np
import pytesseract
import requests

def api(action, **kw):
    r=requests.post(os.environ['GAS_URL'],json=dict(action=action,key=os.environ['WORKER_KEY'],**kw),timeout=120)
    r.raise_for_status()
    j=r.json()
    if not j.get('ok'): raise RuntimeError('GAS rejected request')
    return j

def runs(values, threshold):
    inds=np.flatnonzero(values>=threshold)
    if not len(inds): return []
    groups=np.split(inds,np.where(np.diff(inds)>3)[0]+1)
    return [int(np.median(g)) for g in groups]

def normalize(img):
    h,w=img.shape[:2]
    scale=min(2.5,2200/max(w,1))
    if scale!=1: img=cv2.resize(img,None,fx=scale,fy=scale,interpolation=cv2.INTER_CUBIC if scale>1 else cv2.INTER_AREA)
    gray=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)
    gray=cv2.createCLAHE(clipLimit=2.0,tileGridSize=(8,8)).apply(gray)
    bw=cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY_INV,31,12)
    # Correct modest rotation using long horizontal lines.
    lines=cv2.HoughLinesP(bw,1,np.pi/180,100,minLineLength=gray.shape[1]//3,maxLineGap=30)
    if lines is not None:
        angles=[np.degrees(np.arctan2(y2-y1,x2-x1)) for x1,y1,x2,y2 in lines[:,0] if x2!=x1 and abs(y2-y1)<abs(x2-x1)*.15]
        if angles:
            a=float(np.median(angles))
            if .25<abs(a)<8:
                h,w=gray.shape
                gray=cv2.warpAffine(gray,cv2.getRotationMatrix2D((w/2,h/2),a,1),(w,h),borderValue=255)
    return gray

def ocr(im, lang='rus+eng', psm=6, numeric=False):
    if not im.size: return ''
    if min(im.shape[:2])<36:
        f=36/min(im.shape[:2]); im=cv2.resize(im,None,fx=f,fy=f,interpolation=cv2.INTER_CUBIC)
    im=cv2.copyMakeBorder(im,8,8,8,8,cv2.BORDER_CONSTANT,value=255)
    cfg=f'--psm {psm}'
    if numeric: cfg+=' -c tessedit_char_whitelist=0123456789,.'
    return pytesseract.image_to_string(im,lang=lang,config=cfg,timeout=20).strip()

def number(s):
    s=s.strip().replace(' ','').replace(',','.')
    if not re.fullmatch(r'\d+(?:\.\d{1,4})?',s): return None
    try: return Decimal(s)
    except InvalidOperation: return None

def grams(name):
    if re.search(r'\d+\s*[-–]\s*\d+\s*(?:кг|г)\b',name,re.I): return None
    m=re.search(r'(\d+(?:[.,]\d+)?)\s*(кг|г|гр)\b',name,re.I)
    if not m:return None
    return float(m[1].replace(',','.'))*(1000 if m[2].lower()=='кг' else 1)

def row(name,p=None,q=None,s=None):
    name=re.sub(r'\s*[|/]\s*[/|]?\s*(Продукты питания|Напитки|Игра|Косметика и парфюмерия).*','',name,flags=re.I)
    name=re.sub(r'\s+',' ',name).strip(' |/.,')
    if len(name)<3 or not re.search('[а-яА-Яa-zA-Z]',name) or re.search(r'наименование товара|^итого|^сумма к оплате|^в том числе|^всего на сумму',name,re.I):return None
    valid=p is not None and q is not None and s is not None and q>0 and abs(p*q-s)<=Decimal('0.02')
    return dict(name=name,price=float(p) if p is not None else None,qty=float(q) if q is not None else None,sum=float(s) if s is not None else None,grams=grams(name),status='Проверено по сумме' if valid else 'Проверить OCR')

def cell(gray,x1,x2,y1,y2):
    return gray[max(0,y1+3):y2-3,max(0,x1+3):x2-3]

def table_rows(gray):
    h,w=gray.shape
    bw=cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY_INV,31,12)
    hm=cv2.morphologyEx(bw,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(30,w//8),1)))
    vm=cv2.morphologyEx(bw,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,max(25,h//12))))
    ys=runs(np.count_nonzero(hm,axis=1),w*.45)
    if len(ys)<2:return [],0
    # Keep horizontal separators of the main table; ignore distant footer lines.
    groups=[]; group=[ys[0]]
    for y in ys[1:]:
        if y-group[-1]>h*.17:groups.append(group);group=[]
        group.append(y)
    groups.append(group)
    ys=max(groups,key=len)
    if len(ys)<2:return [],0
    top,bottom=ys[0],ys[-1]
    xs=runs(np.count_nonzero(vm[top:bottom+1,:],axis=0),(bottom-top)*.45)
    if len(xs)<7:return [],bottom
    # First column is the longest; remaining columns are VAT, price, qty, unit, sum.
    options=[xs[i:i+7] for i in range(len(xs)-6)]
    xs=max(options,key=lambda a:(a[1]-a[0])/(a[-1]-a[0]+1))
    if (xs[1]-xs[0])/(xs[-1]-xs[0])<.25:return [],bottom
    result=[]
    for y1,y2 in zip(ys,ys[1:]):
        if y2-y1<14:continue
        name=ocr(cell(gray,xs[0],xs[1],y1,y2))
        if re.search(r'наименование|^итого',name,re.I):continue
        vals=[number(ocr(cell(gray,xs[i],xs[i+1],y1,y2),lang='eng',psm=7,numeric=True)) for i in (2,3,5)]
        r=row(name,*vals)
        if r:result.append(r)
    return result,bottom

def fallback(gray):
    # Preserve candidate names even when the grid or numeric cells cannot be read.
    text=ocr(gray,psm=6)
    result=[]
    for line in text.splitlines():
        if re.search(r'итого|сумма к оплате|наименование|руководитель|бухгалтер|в том числе|всего на сумму',line,re.I):continue
        m=re.search(r'\s+(?:10|20|22|0|Без НДС)\s+([\d.,]+)\s+([\d.,]+)\s+(?:шт\.?|кг)\s+([\d.,]+)\s*$',line,re.I)
        if m:r=row(line[:m.start()],*(number(x) for x in m.groups()))
        elif re.search(r'\d+\s*(?:г|кг|мл|л)\b',line,re.I):r=row(line)
        else:r=None
        if r:result.append(r)
    return result

def metadata(gray,bottom):
    if bottom and bottom<gray.shape[0]-20:
        t=ocr(gray[bottom:,:],psm=11)
    else:t=''
    for line in t.splitlines():
        m=re.search(r'([А-ЯЁа-яё][А-ЯЁа-яё .\-]{2,60})\s+(\d{1,2})[.,](\d{2})(?:[.,](\d{2,4}))?\b',line)
        if m and not re.search(r'сч[её]т|итого|сумм|рубл|лист',m[1],re.I):
            year=int(m[4]) if m[4] else datetime.now(ZoneInfo('Europe/Moscow')).year
            if year<100:year+=2000
            try:return m[1].strip(),datetime(year,int(m[3]),int(m[2])).date().isoformat()
            except ValueError:pass
    return '',''

def parse_image(data):
    img=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR)
    if img is None:raise ValueError('Invalid image')
    gray=normalize(img)
    rows,bottom=table_rows(gray)
    if not rows:rows=fallback(gray)
    point,date=metadata(gray,bottom)
    return rows,point,date

def main():
    deadline=time.monotonic()+12*60
    count=0
    while count<12 and time.monotonic()<deadline:
        job=api('claim')['job']
        if not job:break
        try:
            rows,point,date=parse_image(base64.b64decode(job['data']))
            api('finish',id=job['id'],lease=job['lease'],rows=rows,point=point,date=date,note='Grid/line OCR; verify flagged rows')
            print('Processed image:',len(rows),'candidate rows')
        except Exception:
            print('Image processing failed; marked for review')
            api('fail',id=job['id'],lease=job['lease'])
        count+=1
    print('Jobs handled:',count)

if __name__=='__main__':main()
