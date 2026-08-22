import unittest

from app.services.mail_operations_policy import (
    build_mail_domain_contract,
    classify_smtp_delivery,
    plan_provider_switch,
)


class MailDomainContractTest(unittest.TestCase):
    def test_registered_domain_can_own_subdomain_mail_domain(self) -> None:
        contract = build_mail_domain_contract(
            registered_domain="sinsan.kr",
            mail_domain="moaworks.sinsan.kr",
            admin_access_mode="restricted",
        )

        self.assertEqual(contract.registered_domain, "sinsan.kr")
        self.assertEqual(contract.mail_domain, "moaworks.sinsan.kr")
        self.assertEqual(contract.user_host, "user.moaworks.sinsan.kr")
        self.assertEqual(contract.admin_host, "admin.moaworks.sinsan.kr")
        self.assertEqual(contract.mail_host, "mail.moaworks.sinsan.kr")
        self.assertEqual(contract.inbound_mx_host, "mail.moaworks.sinsan.kr")
        self.assertEqual(contract.admin_access_mode, "restricted")

    def test_split_inbound_mx_host_is_explicit_and_normalized(self) -> None:
        contract = build_mail_domain_contract(
            registered_domain="sinsan.kr",
            mail_domain="dev.moaworks.sinsan.kr",
            inbound_mx_host="MX.DEV.MOAWORKS.SINSAN.KR.",
            admin_access_mode="restricted",
        )

        self.assertEqual(contract.mail_host, "mail.dev.moaworks.sinsan.kr")
        self.assertEqual(contract.inbound_mx_host, "mx.dev.moaworks.sinsan.kr")

    def test_inbound_mx_host_outside_mail_domain_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "수신 MX"):
            build_mail_domain_contract(
                registered_domain="sinsan.kr",
                mail_domain="dev.moaworks.sinsan.kr",
                inbound_mx_host="mx.example.net",
                admin_access_mode="restricted",
            )

    def test_unrelated_mail_domain_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "등록 도메인"):
            build_mail_domain_contract(
                registered_domain="sinsan.kr",
                mail_domain="example.net",
                admin_access_mode="restricted",
            )

    def test_unknown_admin_access_mode_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "관리자 접근"):
            build_mail_domain_contract(
                registered_domain="sinsan.kr",
                mail_domain="moaworks.sinsan.kr",
                admin_access_mode="open-to-all",
            )


class OutboundProviderPolicyTest(unittest.TestCase):
    def test_switch_applies_to_new_mail_and_pins_existing_queue(self) -> None:
        plan = plan_provider_switch(
            current_provider="oci_email_delivery",
            target_provider="self_hosted",
            queued_items=[
                {"queue_id": "queue-1", "provider_key": "oci_email_delivery"},
                {"queue_id": "queue-2", "provider_key": "self_hosted"},
            ],
        )

        self.assertEqual(plan.previous_provider, "oci_email_delivery")
        self.assertEqual(plan.new_message_provider, "self_hosted")
        self.assertEqual(
            plan.pinned_queue_providers,
            {"queue-1": "oci_email_delivery", "queue-2": "self_hosted"},
        )
        self.assertFalse(plan.automatic_cross_provider_retry)

    def test_unknown_provider_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "발신 Provider"):
            plan_provider_switch(
                current_provider="self_hosted",
                target_provider="unknown",
                queued_items=[],
            )

    def test_spam_folder_placement_does_not_fail_smtp_function(self) -> None:
        result = classify_smtp_delivery(
            remote_smtp_accepted=True,
            mailbox_placement="spam",
        )

        self.assertTrue(result.functional_success)
        self.assertEqual(result.mailbox_placement, "spam")

    def test_remote_smtp_rejection_is_functional_failure(self) -> None:
        result = classify_smtp_delivery(
            remote_smtp_accepted=False,
            mailbox_placement=None,
        )

        self.assertFalse(result.functional_success)


if __name__ == "__main__":
    unittest.main()
