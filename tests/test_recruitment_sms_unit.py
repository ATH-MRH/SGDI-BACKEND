import re
import unittest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.db.base import Base
from app.modules import recruitment_sms_service as sms
from app.modules.recruitment_sms_models import RecruitmentSMSChallenge as Challenge

SECRET = 'test-only-secret-not-for-production-1234567890'


class RecruitmentSMSTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite:///:memory:')
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.now = 2000000000

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def request(self, phone='0550001122', ip='127.0.0.1', now=None):
        return sms.request_code(self.db, SECRET, 'Nadia', 'Portail', phone, ip, now=self.now if now is None else now)

    def code(self, challenge):
        row = self.db.get(Challenge, challenge['challenge_id'])
        return re.search(r'\b\d{6}\b', sms.cipher(SECRET).decrypt(row.sms_ciphertext.encode()).decode())[0]

    def test_phone_normalization_and_validation(self):
        self.assertEqual(sms.normalize_phone('0550 00 11 22'), '+213550001122')
        self.assertEqual(sms.normalize_phone('00213550001122'), '+213550001122')
        for bad in ['021000000', '+33612345678', 'not a phone']:
            with self.assertRaises(sms.SMSProblem): sms.normalize_phone(bad)

    def test_request_never_returns_code_and_database_encrypts_sms(self):
        response = self.request()
        code = self.code(response)
        self.assertNotIn(code, str(response))
        row = self.db.get(Challenge, response['challenge_id'])
        self.assertNotIn(code, row.sms_ciphertext)
        self.assertNotEqual(code, row.code_digest)
        self.assertEqual(row.phone, '+213550001122')

    def test_sms_gateway_lease_and_idempotent_ack(self):
        response = self.request()
        job = sms.gateway_poll(self.db, SECRET, now=self.now)['job']
        self.assertEqual(job['id'], response['challenge_id'])
        self.assertIn(self.code(response), job['message'])
        self.assertIsNone(sms.gateway_poll(self.db, SECRET, now=self.now + 1)['job'])
        for _ in range(2):
            sms.gateway_ack(self.db, SECRET, job['id'], job['lease_token'], True, now=self.now + 1)
        self.assertEqual(self.db.get(Challenge, job['id']).status, 'sent')
        self.assertEqual(self.db.get(Challenge, job['id']).sms_ciphertext, '')

    def test_gateway_reclaims_lost_lease_and_rejects_old_ack(self):
        self.request()
        first = sms.gateway_poll(self.db, SECRET, now=self.now)['job']
        second = sms.gateway_poll(self.db, SECRET, now=self.now + 61)['job']
        self.assertEqual(first['id'], second['id'])
        self.assertNotEqual(first['lease_token'], second['lease_token'])
        with self.assertRaises(sms.SMSProblem):
            sms.gateway_ack(self.db, SECRET, first['id'], first['lease_token'], True, now=self.now + 62)
        self.db.rollback()

    def test_verification_binds_identity_and_has_own_token_family(self):
        response = self.request()
        verified = sms.verify_code(self.db, SECRET, response['challenge_id'], self.code(response), now=self.now)
        row = sms.identity(self.db, SECRET, verified['access_token'], now=self.now)
        self.assertEqual(row.first_name, 'Nadia')
        self.assertEqual(verified['identity']['phone'], '+213550001122')
        self.assertEqual(verified['expires_in'], 7200)
        with self.assertRaises(sms.SMSProblem): sms.identity(self.db, SECRET, 'staff-token', now=self.now)

    def test_code_is_single_use(self):
        response = self.request()
        code = self.code(response)
        sms.verify_code(self.db, SECRET, response['challenge_id'], code, now=self.now)
        with self.assertRaises(sms.SMSProblem): sms.verify_code(self.db, SECRET, response['challenge_id'], code, now=self.now)

    def test_five_wrong_attempts_lock_even_the_correct_code(self):
        response = self.request()
        code = self.code(response)
        wrong = '000000' if code != '000000' else '111111'
        for _ in range(5):
            with self.assertRaises(sms.SMSProblem): sms.verify_code(self.db, SECRET, response['challenge_id'], wrong, now=self.now)
        self.assertEqual(self.db.get(Challenge, response['challenge_id']).attempts, 5)
        with self.assertRaises(sms.SMSProblem): sms.verify_code(self.db, SECRET, response['challenge_id'], code, now=self.now)

    def test_expired_code_and_session_are_rejected(self):
        response = self.request()
        code = self.code(response)
        with self.assertRaises(sms.SMSProblem): sms.verify_code(self.db, SECRET, response['challenge_id'], code, now=self.now + 300)
        verified = sms.verify_code(self.db, SECRET, response['challenge_id'], code, now=self.now)
        with self.assertRaises(sms.SMSProblem): sms.identity(self.db, SECRET, verified['access_token'], now=self.now + 7200)

    def test_resend_delay_and_old_code_invalidation(self):
        first = self.request()
        old_code = self.code(first)
        with self.assertRaises(sms.SMSProblem): self.request(now=self.now + 30)
        self.request(now=self.now + 60)
        with self.assertRaises(sms.SMSProblem): sms.verify_code(self.db, SECRET, first['challenge_id'], old_code, now=self.now + 61)

    def test_per_phone_and_ip_quotas(self):
        for index in range(5): self.request(now=self.now + index * 61)
        with self.assertRaises(sms.SMSProblem) as result: self.request(now=self.now + 305)
        self.assertEqual(result.exception.status, 429)
        for index in range(15): self.request(phone=f'055{index:07d}', now=self.now + 305)
        with self.assertRaises(sms.SMSProblem): self.request(phone='0771234567', now=self.now + 305)

    def test_failed_delivery_stops_after_three_attempts(self):
        self.request()
        for index in range(3):
            job = sms.gateway_poll(self.db, SECRET, now=self.now + index)['job']
            sms.gateway_ack(self.db, SECRET, job['id'], job['lease_token'], False, now=self.now + index)
        self.assertIsNone(sms.gateway_poll(self.db, SECRET, now=self.now + 4)['job'])
        self.assertEqual(self.db.scalar(select(Challenge)).status, 'failed')
