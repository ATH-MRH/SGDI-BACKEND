from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, model_validator
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.drh import service
from app.modules.drh.schemas import CandidateCreate


router = APIRouter()


class PublicExperienceIn(BaseModel):
    society: Annotated[str | None, Field(default=None, max_length=150)]
    start_date: Annotated[str | None, Field(default=None, max_length=10)]
    end_date: Annotated[str | None, Field(default=None, max_length=10)]
    position: Annotated[str | None, Field(default=None, max_length=150)]
    departure_reason: Annotated[str | None, Field(default=None, max_length=300)]


class PublicEducationIn(BaseModel):
    institution: Annotated[str | None, Field(default=None, max_length=180)]
    degree: Annotated[str | None, Field(default=None, max_length=150)]
    specialty: Annotated[str | None, Field(default=None, max_length=150)]
    start_date: Annotated[str | None, Field(default=None, max_length=10)]
    end_date: Annotated[str | None, Field(default=None, max_length=10)]


class PublicCandidateIn(BaseModel):
    first_name: Annotated[str, Field(min_length=2, max_length=100)]
    last_name: Annotated[str, Field(min_length=2, max_length=100)]
    phone: Annotated[str | None, Field(default=None, max_length=40)]
    email: EmailStr | None = None
    birth_date: Annotated[str | None, Field(default=None, max_length=10)]
    birth_place: Annotated[str | None, Field(default=None, max_length=120)]
    sex: Annotated[str | None, Field(default=None, max_length=20)]
    family_status: Annotated[str | None, Field(default=None, max_length=80)]
    children_count: Annotated[int, Field(default=0, ge=0, le=20)]
    blood_group: Annotated[str | None, Field(default=None, max_length=4)]
    father_name: Annotated[str | None, Field(default=None, max_length=120)]
    mother_name: Annotated[str | None, Field(default=None, max_length=120)]
    nin: Annotated[str | None, Field(default=None, max_length=30)]
    address: Annotated[str | None, Field(default=None, max_length=500)]
    commune: Annotated[str | None, Field(default=None, max_length=120)]
    wilaya: Annotated[str | None, Field(default=None, max_length=120)]
    desired_position: Annotated[str, Field(min_length=2, max_length=150)]
    society: Annotated[str | None, Field(default=None, max_length=150)]
    expected_salary: Annotated[float | None, Field(default=None, ge=0, le=100_000_000)]
    availability: Annotated[str | None, Field(default=None, max_length=80)]
    military_service: Annotated[str | None, Field(default=None, max_length=80)]
    languages: list[Annotated[str, Field(max_length=60)]] = Field(default_factory=list, max_length=12)
    experience: list[PublicExperienceIn] = Field(default_factory=list, max_length=20)
    education: list[PublicEducationIn] = Field(default_factory=list, max_length=20)
    consent: bool
    company: Annotated[str | None, Field(default=None, max_length=120)] = None

    @model_validator(mode="after")
    def validate_submission(self):
        if not self.phone and not self.email:
            raise ValueError("Un téléphone ou un email est obligatoire")
        if not self.consent:
            raise ValueError("Le consentement est obligatoire")
        return self


@router.post("/candidates", status_code=status.HTTP_201_CREATED)
def submit_public_candidate(payload: PublicCandidateIn, request: Request, db: Session = Depends(get_db)):
    # Champ invisible anti-robot : une vraie personne ne le remplit jamais.
    if payload.company:
        raise HTTPException(status_code=400, detail="Candidature invalide")
    now = datetime.utcnow().isoformat()
    candidate = CandidateCreate(
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        phone=(payload.phone or "").strip() or None,
        email=str(payload.email) if payload.email else None,
        desired_position=payload.desired_position.strip(),
        society=(payload.society or "").strip() or None,
        expected_salary=payload.expected_salary,
        status="nouvelle",
        data={
            "moduleOrigine": "fr.irongs.com",
            "sourceExterne": "portail_candidat",
            "ficheCandidatTransmise": True,
            "submittedAt": now,
            "dateNaissance": payload.birth_date or "",
            "lieuNaissance": payload.birth_place or "",
            "sexe": payload.sex or "",
            "situation": payload.family_status or "",
            "nombreEnfants": payload.children_count,
            "groupeSanguin": payload.blood_group or "",
            "nomPere": payload.father_name or "",
            "nomMere": payload.mother_name or "",
            "nin": payload.nin or "",
            "adresse": payload.address or "",
            "commune": payload.commune or "",
            "wilaya": payload.wilaya or "",
            "posteSouhaite": payload.desired_position,
            "disponibilite": payload.availability or "",
            "serviceMilitaire": payload.military_service or "",
            "langues": payload.languages,
            "experience": [
                {
                    "societe": row.society or "",
                    "du": row.start_date or "",
                    "au": row.end_date or "",
                    "poste": row.position or "",
                    "motif": row.departure_reason or "",
                }
                for row in payload.experience
            ],
            "formations": [
                {
                    "etablissement": row.institution or "",
                    "diplome": row.degree or "",
                    "specialite": row.specialty or "",
                    "du": row.start_date or "",
                    "au": row.end_date or "",
                }
                for row in payload.education
            ],
            "consentementCandidatAt": now,
            "remoteAddress": request.client.host if request.client else "",
        },
    )
    row = service.create_candidate(db, candidate, username="portail-candidat")
    return {"status": "received", "reference": f"CAND-{datetime.utcnow().year}-{row.id:06d}"}
