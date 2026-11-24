import unittest
from decimal import Decimal
from worker import number, grams, row

class ParserTest(unittest.TestCase):
    def test_precision(self):
        self.assertEqual(number('103,644'),Decimal('103.644'))
        self.assertEqual(number('16,6336'),Decimal('16.6336'))
    def test_line_sum(self):
        r=row('Говядина тушеная 338 г',Decimal('82.17'),Decimal('5'),Decimal('410.85'))
        self.assertEqual(r['status'],'Проверено по сумме')
        self.assertEqual(r['grams'],338)
    def test_partial(self):
        r=row('Бекон сырокопченый 150 г')
        self.assertIsNone(r['price'])
        self.assertEqual(r['status'],'Проверить OCR')
    def test_variable_weight(self):
        self.assertIsNone(grams('Томаты 300-500 г'))
    def test_header(self):
        self.assertIsNone(row('Наименование товара'))
    def test_units(self):
        self.assertEqual(grams('Мясо 1,5 кг'),1500)
if __name__=='__main__':unittest.main()
