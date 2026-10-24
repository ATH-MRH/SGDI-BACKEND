"""OPS drafts and immutable official site configurations (no automatic adoption)."""
from datetime import date,datetime
from sqlalchemy import Date,DateTime,ForeignKey,Integer,JSON,String,Text,UniqueConstraint,event,inspect
from sqlalchemy.orm import Mapped,mapped_column
from app.db.base import Base


class RotationDraft(Base):
    __tablename__='rotation_configuration_drafts'
    id:Mapped[int]=mapped_column(primary_key=True)
    site_id:Mapped[int]=mapped_column(ForeignKey('sites.id'),index=True)
    version:Mapped[int]=mapped_column(Integer,default=1)
    config:Mapped[dict]=mapped_column(JSON)
    effective_from:Mapped[date]=mapped_column(Date)
    reason:Mapped[str]=mapped_column(Text)
    created_by:Mapped[str]=mapped_column(String(120))
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
    simulation:Mapped[dict|None]=mapped_column(JSON)


class OfficialRotation(Base):
    __tablename__='official_rotation_configurations'
    __table_args__=(UniqueConstraint('site_id','version',name='uq_official_rotation_site_version'),
                   UniqueConstraint('draft_id',name='uq_official_rotation_draft'))
    id:Mapped[int]=mapped_column(primary_key=True)
    site_id:Mapped[int]=mapped_column(ForeignKey('sites.id'),index=True)
    draft_id:Mapped[int]=mapped_column(ForeignKey('rotation_configuration_drafts.id'))
    version:Mapped[int]=mapped_column(Integer)
    effective_from:Mapped[date]=mapped_column(Date,index=True)
    effective_to:Mapped[date|None]=mapped_column(Date)  # Exclusive; close only a future boundary.
    config:Mapped[dict]=mapped_column(JSON)
    simulation_hash:Mapped[str]=mapped_column(String(64))
    published_by:Mapped[str]=mapped_column(String(120))
    published_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
    reason:Mapped[str]=mapped_column(Text)


@event.listens_for(OfficialRotation,'before_update')
def immutable_configuration(mapper,connection,target):
    changed={a.key for a in inspect(target).attrs if a.history.has_changes()}
    if changed-{'effective_to'}:
        raise ValueError('Une publication officielle est immuable')


@event.listens_for(OfficialRotation,'before_delete')
def no_delete(mapper,connection,target):
    raise ValueError('Une publication officielle ne peut être supprimée')
