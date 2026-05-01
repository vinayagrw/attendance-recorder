-- Feature flags table for gradual feature rollouts
-- Allows orgs to control feature visibility

create table if not exists feature_flags (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001'
        references organisations(id) on delete cascade,
    key text not null,
    name text not null,
    description text,
    enabled boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    updated_by uuid references supervisors(id),
    unique(org_id, key)
);

create index if not exists feature_flags_org_key on feature_flags(org_id, key);

-- RLS: only admins can read/write feature flags
alter table feature_flags enable row level security;

create policy "feature_flags_admin_read" on feature_flags
    for select using (
        auth.uid() in (select id from supervisors where role = 'admin')
    );

create policy "feature_flags_admin_write" on feature_flags
    for update using (
        auth.uid() in (select id from supervisors where role = 'admin')
    )
    with check (
        auth.uid() in (select id from supervisors where role = 'admin')
    );

-- Initialize default feature flags
insert into feature_flags (org_id, key, name, description, enabled)
values
    ('00000000-0000-0000-0000-000000000001', 'analytics_dashboard', 'Analytical Dashboard', 'View hours, charts, and worker analytics', false),
    ('00000000-0000-0000-0000-000000000001', 'advanced_filters', 'Advanced Filters', 'Use advanced filters in reports', true),
    ('00000000-0000-0000-0000-000000000001', 'daily_attendance_table', 'Daily Attendance Table', 'View daily attendance in tabular format', true),
    ('00000000-0000-0000-0000-000000000001', 'chart_exports', 'Chart Exports', 'Export charts as images', false)
on conflict (org_id, key) do nothing;

