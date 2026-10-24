"""Central OPS configurations only. No site adoption and no historical rewrites.

The earlier V7 adoption must be resolved in the release plan before executing an
upgrade from a populated pre-V7 database; this revision cannot undo its effects.
"""
from alembic import op
import sqlalchemy as sa
revision='20261026_0001'
down_revision='20261025_0001'
branch_labels=None
depends_on=None


def upgrade():
    bind=op.get_bind()
    if not sa.inspect(bind).has_table('rotation_configuration_drafts'):
        op.create_table('rotation_configuration_drafts',
            sa.Column('id',sa.Integer(),primary_key=True),sa.Column('site_id',sa.Integer(),sa.ForeignKey('sites.id'),nullable=False),
            sa.Column('version',sa.Integer(),nullable=False),sa.Column('config',sa.JSON(),nullable=False),
            sa.Column('effective_from',sa.Date(),nullable=False),sa.Column('reason',sa.Text(),nullable=False),
            sa.Column('created_by',sa.String(120),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False),
            sa.Column('simulation',sa.JSON()))
        op.create_index('ix_rotation_configuration_drafts_site_id','rotation_configuration_drafts',['site_id'])
    if not sa.inspect(bind).has_table('official_rotation_configurations'):
        op.create_table('official_rotation_configurations',
            sa.Column('id',sa.Integer(),primary_key=True),sa.Column('site_id',sa.Integer(),sa.ForeignKey('sites.id'),nullable=False),
            sa.Column('draft_id',sa.Integer(),sa.ForeignKey('rotation_configuration_drafts.id'),nullable=False),
            sa.Column('version',sa.Integer(),nullable=False),sa.Column('effective_from',sa.Date(),nullable=False),
            sa.Column('effective_to',sa.Date()),sa.Column('config',sa.JSON(),nullable=False),
            sa.Column('simulation_hash',sa.String(64),nullable=False),sa.Column('published_by',sa.String(120),nullable=False),
            sa.Column('published_at',sa.DateTime(),nullable=False),sa.Column('reason',sa.Text(),nullable=False),
            sa.UniqueConstraint('site_id','version',name='uq_official_rotation_site_version'),
            sa.UniqueConstraint('draft_id',name='uq_official_rotation_draft'))
        op.create_index('ix_official_rotation_configurations_site_id','official_rotation_configurations',['site_id'])
        op.create_index('ix_official_rotation_configurations_effective_from','official_rotation_configurations',['effective_from'])
    inspector=sa.inspect(bind)
    expected={
      'rotation_configuration_drafts':{'id','site_id','version','config','effective_from','reason','created_by','created_at','simulation'},
      'official_rotation_configurations':{'id','site_id','draft_id','version','effective_from','effective_to','config','simulation_hash','published_by','published_at','reason'}}
    nullable={'simulation','effective_to'}
    for table,names in expected.items():
        columns={c['name']:c for c in inspector.get_columns(table)}
        if set(columns)!=names or any(columns[n]['nullable'] for n in names-nullable):
            raise RuntimeError('Schéma central préexistant incompatible : '+table)
        foreign={tuple(f['constrained_columns']):f['referred_table'] for f in inspector.get_foreign_keys(table)}
        if foreign.get(('site_id',))!='sites':raise RuntimeError('Clé site centrale incompatible')
        if table=='official_rotation_configurations':
            unique={tuple(u['column_names']) for u in inspector.get_unique_constraints(table)}
            if foreign.get(('draft_id',))!='rotation_configuration_drafts' or not {('site_id','version'),('draft_id',)}<=unique:
                raise RuntimeError('Contraintes de publication centrales incompatibles')
    if bind.dialect.name=='postgresql':
        # No btree_gist extension or privileged extension installation required.
        op.execute('''CREATE OR REPLACE FUNCTION protect_official_rotation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Official planning is immutable'; END IF;
          PERFORM id FROM sites WHERE id=NEW.site_id FOR UPDATE;
          IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW)-'effective_to') IS DISTINCT FROM (to_jsonb(OLD)-'effective_to')
             OR OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL
             OR NEW.effective_to <= CURRENT_DATE OR NEW.effective_to <= NEW.effective_from) THEN
             RAISE EXCEPTION 'Official planning is immutable';
          END IF;
          IF EXISTS(SELECT 1 FROM official_rotation_configurations p WHERE p.site_id=NEW.site_id AND p.id<>NEW.id
             AND daterange(p.effective_from,p.effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN
             RAISE EXCEPTION 'Official planning periods overlap';
          END IF;
          RETURN NEW;
        END $$''')
        op.execute('DROP TRIGGER IF EXISTS official_rotation_immutable ON official_rotation_configurations')
        op.execute('CREATE TRIGGER official_rotation_immutable BEFORE INSERT OR UPDATE OR DELETE ON official_rotation_configurations FOR EACH ROW EXECUTE FUNCTION protect_official_rotation()')


def downgrade():
    bind=op.get_bind()
    if bind.scalar(sa.text('SELECT count(*) FROM official_rotation_configurations')) or bind.scalar(sa.text('SELECT count(*) FROM rotation_configuration_drafts')):
        raise RuntimeError('Downgrade refusé : publications officielles à conserver')
    op.drop_table('official_rotation_configurations');op.drop_table('rotation_configuration_drafts')
    if bind.dialect.name=='postgresql':op.execute('DROP FUNCTION IF EXISTS protect_official_rotation()')
