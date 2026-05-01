-- Seed for local dev: one project, one site (Bangalore), one supervisor (you
-- create the auth user via the Studio first, then paste their UUID here),
-- and three sample workers.

insert into projects (id, name, client_name, status)
values ('11111111-1111-1111-1111-111111111111',
        'Demo Project — Bangalore Tower A',
        'Acme Realty',
        'active')
on conflict do nothing;

insert into sites (id, project_id, name, address,
                   default_lat, default_lng, default_radius_m, timezone)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'Tower A — Whitefield',
        'Whitefield Main Rd, Bangalore',
        12.9698, 77.7500, 150, 'Asia/Kolkata')
on conflict do nothing;

insert into workers (id, full_name, status) values
    ('33333333-3333-3333-3333-333333333333', 'Ravi Kumar',  'invited'),
    ('44444444-4444-4444-4444-444444444444', 'Priya Singh', 'invited'),
    ('55555555-5555-5555-5555-555555555555', 'Anil Yadav',  'invited')
on conflict do nothing;

insert into worker_site_assignments (worker_id, site_id, is_primary) values
    ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', true),
    ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', true),
    ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', true)
on conflict do nothing;
