from app.schemas.directory import DomainVerifyItem, DomainVerifyResponse
from app.services.directory_store import DirectoryStore


class DomainService:
    def __init__(self, store: DirectoryStore) -> None:
        self.store = store

    def verify(self, domain: str) -> DomainVerifyResponse:
        normalized = domain.strip().lower()
        if "." not in normalized:
            raise ValueError("도메인 형식이 올바르지 않습니다.")

        company = self.store.get_overview().company
        matches_company = normalized == company.domain.lower()

        checks = [
            DomainVerifyItem(
                recordType="MX",
                host=normalized,
                expectedValue="mail." + normalized,
                status="pass" if matches_company else "warning",
                message="설계상 대표 MX 호스트 기준과 일치합니다." if matches_company else "회사 기본 도메인과 다릅니다. 운영 전 실제 MX 확인이 필요합니다.",
            ),
            DomainVerifyItem(
                recordType="SPF",
                host=normalized,
                expectedValue="v=spf1 include:mail-layer ~all",
                status="pass" if matches_company else "warning",
                message="로컬 Relay 기준 SPF 초안입니다." if matches_company else "외부 DNS 조회 없이 형식 안내만 제공합니다.",
            ),
            DomainVerifyItem(
                recordType="DKIM",
                host=f"selector1._domainkey.{normalized}",
                expectedValue="k=rsa; p=<generated-public-key>",
                status="pending",
                message="단계 2에서는 DKIM 공개키 배포 전이므로 안내 상태로 유지합니다.",
            ),
            DomainVerifyItem(
                recordType="DMARC",
                host=f"_dmarc.{normalized}",
                expectedValue="v=DMARC1; p=none; rua=mailto:postmaster@" + normalized,
                status="pass" if matches_company else "warning",
                message="운영 전 모니터링 정책 초안을 제공합니다.",
            ),
        ]

        overall_status = "pass" if matches_company else "warning"
        return DomainVerifyResponse(domain=normalized, overallStatus=overall_status, checks=checks)

