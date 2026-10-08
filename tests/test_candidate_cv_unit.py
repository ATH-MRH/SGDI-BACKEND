import base64
import unittest
from app.core.candidate_cv import apply_cv, validate_cv, MAX_CV_BYTES


def upload(mime='application/pdf', content=b'%PDF-1.7\nminimal test', name='CV.pdf'):
    return {'name': name, 'mime_type': mime, 'data_base64': base64.b64encode(content).decode()}


class CandidateCVTests(unittest.TestCase):
    def test_three_formats(self):
        for mime, content, name in [('application/pdf', b'%PDF-1.7\ntest', 'CV.pdf'), ('image/jpeg', b'\xff\xd8\xfftest', 'CV.jpg'), ('image/png', b'\x89PNG\r\n\x1a\ntest', 'CV.png')]:
            metadata, encoded = validate_cv(upload(mime, content, name))
            self.assertEqual(metadata['size'], len(content))
            self.assertEqual(base64.b64decode(encoded), content)

    def test_wrong_content_rejected(self):
        with self.assertRaises(ValueError): validate_cv(upload(content=b'not a pdf'))

    def test_invalid_base64_rejected(self):
        with self.assertRaises(ValueError): validate_cv({**upload(), 'data_base64': 'invalid!@@'})

    def test_executable_rejected(self):
        with self.assertRaises(ValueError): validate_cv(upload('application/octet-stream', b'MZtest', 'CV.exe'))

    def test_oversize_and_empty_rejected(self):
        for content in [b'', b'%PDF-' + b'x' * MAX_CV_BYTES]:
            with self.assertRaises(ValueError): validate_cv(upload(content=content))

    def test_preserve_replace_and_remove(self):
        original = apply_cv({'cvUpload': upload()})
        self.assertEqual(apply_cv({'notes':'change'}, original)['_cv_content'], original['_cv_content'])
        replaced = apply_cv({'cvUpload': upload(content=b'%PDF-new')}, original)
        self.assertNotEqual(replaced['_cv_content'], original['_cv_content'])
        self.assertNotIn('cv', apply_cv({'cvUpload':None}, original))
        self.assertNotIn('_cv_content', apply_cv({'cvUpload':None}, original))

    def test_private_content_cannot_be_injected(self):
        self.assertEqual(apply_cv({'_cv_content':'fabricated','cv':{'name':'fake'}}), {})
        metadata, _ = validate_cv(upload(name='../../CV.pdf'))
        self.assertEqual(metadata['name'], 'CV.pdf')
