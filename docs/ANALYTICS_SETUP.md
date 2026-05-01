# Analytics Dashboard - Quick Start Guide

## Prerequisites
- Local Supabase stack running: `pnpm supabase:start`
- Admin supervisor account created: `bash scripts/ci-setup.sh`

## Installation Steps

### 1. Update Dependencies
```bash
cd apps/web
pnpm install
```

### 2. Apply Database Migrations
```bash
# Local development
npx supabase db reset

# Production
npx supabase db push
```

This will create:
- `feature_flags` table with default flags
- 4 analytics RPC functions (hours_per_project, hours_per_worker_project, worker_count_per_project, daily_attendance)

### 3. Rebuild Frontend
```bash
pnpm build
pnpm dev
```

### 4. Enable Feature Flag (for testing)

1. Open http://localhost:5173 (or your dev URL)
2. Log in as admin:
   - Email: `viagr@ciklum.com`
   - Password: `LocalDev2026!`
3. Navigate to `/admin/projects`
4. Click "🚩 Feature Flags" button
5. Toggle on: `analytics_dashboard`
6. Go to `/supervisor/dashboard` and you'll see a new "Analytics" (📊) tile

### 5. Verify Charts Load
1. Click the Analytics tile
2. You should see:
   - Filter section (date range, project selector)
   - View toggle button (Desktop/Mobile)
   - Four charts (loading placeholders until data arrives)
   - Daily attendance table below

> **Note**: Charts will be empty if you don't have any attendance data. Create test punches first using the worker app, or use the seeded test data.

## Testing with Sample Data

If charts appear empty, generate test attendance data:

```sql
-- In Supabase Studio or via psql
-- This creates 10 punch pairs (IN/OUT) for today on the seeded project
insert into attendance (worker_id, site_id, type, status, flag_reasons)
select
  (select id from workers limit 1) as worker_id,
  (select id from sites limit 1) as site_id,
  case when random() < 0.5 then 'in' else 'out' end,
  'verified',
  '{}'
from generate_series(1, 20);
```

Then refresh the analytics page—charts should populate.

## Feature Flags Reference

| Flag | Default | Purpose |
|------|---------|---------|
| `analytics_dashboard` | OFF | Enable/disable entire analytics feature |
| `advanced_filters` | ON | Advanced filtering in reports |
| `daily_attendance_table` | ON | Daily attendance table in analytics |
| `chart_exports` | OFF | Export charts as images (not yet implemented) |

To toggle via the UI:
- Admin: `/admin/feature-flags`
- Or SQL: `update feature_flags set enabled = true where key = 'analytics_dashboard';`

## Troubleshooting

### "Feature flag not found" error
- Run migrations again: `npx supabase db reset`
- Check: `select * from feature_flags;` in Supabase Studio

### Charts not loading / blank data
- Check browser console (F12) for errors
- Verify attendance records exist: `select count(*) from attendance where status in ('verified', 'auto_closed');`
- Check that date range filter includes punch dates

### RPC function 404 error
- Ensure migrations 0015 & 0016 ran: `select * from information_schema.routines where routine_name like 'analytics%';`
- Restart dev server: `pnpm dev`

### Recharts not rendering
- Verify package.json has `recharts: ^2.12.7`
- Clear node_modules: `rm -rf node_modules && pnpm install`
- Restart: `pnpm dev`

## Layout Modes

**Desktop Mode** (default on screens ≥1024px)
- 2-column grid of charts
- Larger chart areas
- Full table width

**Mobile Mode** (default on screens <768px)
- 1-column stacked layout
- Touch-friendly
- Horizontal scroll table

**Manual Toggle**
- Button in top-right of analytics page
- Choice persists in localStorage
- Allows mobile users to see desktop layout if desired

## Next Steps After Launch

1. **Gather supervisor feedback** — Are the charts useful? Missing any data?
2. **Adjust data range** — Default 30 days; should it be configurable per org?
3. **Add anomaly summary** — Show which punches had flags in this period
4. **Enable chart exports** — Implement PDF/PNG download
5. **Real-time updates** — Subscribe to new attendance via Realtime
6. **Email reports** — Scheduled analytics digest to supervisors

## Architecture Highlights

- **RPC functions** compute hours server-side (avoids large data transfers)
- **Feature flags** allow gradual rollout without code changes
- **Responsive design** adapts to viewport + manual toggle preference
- **TanStack Query** caches results (5–10 min) to reduce DB load
- **RLS policies** ensure supervisors see only their project scope

## Support
- See `docs/ANALYTICS_IMPLEMENTATION.md` for detailed architecture
- See `plan.md` section 23 for requirements

