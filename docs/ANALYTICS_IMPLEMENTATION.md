# Analytical Dashboard Implementation Guide

## Overview

This document describes the implementation of the analytical dashboard with feature flags, responsive layout toggle, and comprehensive analytics views.

## What's New

### 1. **Feature Flags System** (`feature_flags` table)
- Admins can control feature visibility from `/admin/feature-flags`
- Features can be enabled/disabled without code changes
- Gradual rollout capability for new features

**Default Flags:**
- `analytics_dashboard` - Main analytics view (default: disabled)
- `advanced_filters` - Advanced filtering options (default: enabled)
- `daily_attendance_table` - Daily attendance table view (default: enabled)
- `chart_exports` - Export charts as images (default: disabled)

### 2. **Analytics RPC Functions** (New migrations 0015, 0016)

#### `analytics_hours_per_project(p_start, p_end)`
Returns total hours worked per project within a date range.
- `project_id`: UUID
- `project_name`: Text
- `total_hours`: Numeric (sum of verified + auto_closed spans)
- `punch_count`: Count of punches
- `worker_count`: Unique workers count

#### `analytics_hours_per_worker_project(p_start, p_end, p_project_id)`
Returns hours per worker broken down by project.
- Filters by project if provided
- Includes `days_worked` (unique dates)

#### `analytics_worker_count_per_project()`
Returns active and total worker count per project.
- Real-time snapshot (not date-filtered)

#### `analytics_daily_attendance(p_start, p_end, p_project_id)`
Returns paired punch records (IN + OUT) with calculated hours.
- Includes all punch metadata (GPS, flags, reviewer comment)
- Grouped by date, worker, site

### 3. **New Components & Hooks**

#### Hooks
- **`useFeatureFlag(key)`** - Check if a feature is enabled for current org
- **`useAllFeatureFlags()`** - Fetch all flags for admin panel
- **`useLayoutMode()`** - Toggle between desktop/mobile view; persists to localStorage
- **`useViewportWidth()`** - Detect screen size (isDesktop, isTablet, isMobile)
- **`useAnalyticsHoursPerProject(startDate, endDate, enabled)`** - Fetch hours per project
- **`useAnalyticsHoursPerWorkerProject(startDate, endDate, projectId, enabled)`** - Fetch hours per worker
- **`useAnalyticsWorkerCountPerProject(enabled)`** - Fetch worker counts
- **`useAnalyticsDailyAttendance(startDate, endDate, projectId, enabled)`** - Fetch daily records

#### Components
- **`BarChart`** - Vertical bar chart (hours, counts, etc.)
- **`PieChart`** - Pie chart with legend and labels
- **`HorizontalBarChart`** - Horizontal layout for worker names

### 4. **New Routes**

#### Supervisor
- **`/supervisor/analytics`** - Main analytics dashboard (feature-flagged)
  - Date range filters (default: last 30 days)
  - Project drill-down filter
  - Desktop ↔️ Mobile view toggle
  - Charts:
    1. Hours per project (bar + pie)
    2. Worker count per project (bar + pie)
    3. Top workers by hours (horizontal bar)
    4. Daily attendance table (tabular)

#### Admin
- **`/admin/feature-flags`** - Feature flag management
  - List all flags with toggles
  - One-click enable/disable
  - Real-time effect (no redeploy needed)

### 5. **Responsive Layout**

**Mobile Mode** (`grid-cols-1`)
- Single column layout
- Optimized touch targets
- Scrollable tables
- Persistent preference in localStorage

**Desktop Mode** (`grid-cols-2 lg:grid-cols-4`)
- Multi-column grid
- Larger chart heights
- Side-by-side comparisons

Toggle button on analytics page: **"🖥 Desktop" / "📱 Mobile"**

## How to Use

### For Supervisors: Access Analytics

1. Go to `/supervisor/dashboard`
2. If analytics is enabled, you'll see an "Analytics" tile (📊)
3. Click to open `/supervisor/analytics`
4. Use date range + project filters to drill down
5. Toggle view mode with button in top-right

### For Admins: Control Features

1. Go to `/admin/projects` (or any admin page)
2. Click "🚩 Feature Flags" button
3. Toggle features on/off
4. Changes are instant—no redeploy needed

## Data Freshness & Caching

- **Hour calculations**: 5 min cache (staleTime: 300s)
- **Worker counts**: 10 min cache
- **Daily attendance**: 5 min cache
- **Feature flags**: 5 min cache

Clear via browser devtools or automatic refresh on mutation.

## Architecture Decisions

### Why RPC Functions?
- Complex aggregations (window functions for paired punches) belong in the database
- Reduces network overhead vs. fetching all raw records
- Consistent hour calculations across the app
- RLS policies protect data (supervisors see only their project scope)

### Why Feature Flags?
- Zero-downtime feature rollouts
- A/B test new dashboards with specific teams
- Kill switches without redeployment
- Feedback collection before full launch

### Why Separate `useLayoutMode` Hook?
- Decoupled from viewport size
- Allows manual override (mobile user can choose desktop layout)
- Persisted to localStorage (survives page reload)

## Testing Checklist

- [ ] Apply migrations: `npx supabase db reset` (local) or `npx supabase db push` (cloud)
- [ ] Install recharts: `pnpm install`
- [ ] Start app: `pnpm dev`
- [ ] Admin enables feature flag at `/admin/feature-flags`
- [ ] Supervisor sees "Analytics" tile and can navigate
- [ ] Charts render with sample data (if attendance exists)
- [ ] Desktop ↔️ Mobile toggle works; persists on reload
- [ ] Project filter narrows data across all charts
- [ ] Date range changes refresh all queries
- [ ] Feature flag disable hides the entire feature (feature-gated component)

## Known Limitations

1. **Mock Hours Calculation**: Assumes paired IN → OUT punches. Unpaired OUT punches are ignored; unpaired IN punches are shown with null hours.
2. **Chart Export**: Currently stubbed (feature flag exists, not implemented). Use browser "Save as image" for now.
3. **PDF Export**: Not built. Recommend `jspdf` + `html2canvas` post-MVP.
4. **Performance**: RPC queries scan all attendance rows. Add indexes if you have 100k+ punches:
   ```sql
   create index if not exists attendance_status_date on attendance(status, punched_at)
   where status in ('verified', 'auto_closed');
   ```

## Future Enhancements

- **Real-time updates** via Realtime subscriptions (reload on punch event)
- **Trend lines** (hours over weeks/months with forecasting)
- **Anomaly detection** (unusual spikes, workers working >12h, etc.)
- **Shift overlap detection** (two workers on same device simultaneously)
- **Payroll integration** (pre-fill export with dashboard selections)
- **Scheduled reports** (email digest of weekly analytics)
- **Custom dashboard** (supervisors choose which charts to display)

## Files Changed/Created

| File | Type | Purpose |
|------|------|---------|
| `supabase/migrations/0015_feature_flags.sql` | Migration | Feature flags schema + RLS |
| `supabase/migrations/0016_analytics_functions.sql` | Migration | 4 analytics RPC functions |
| `apps/web/package.json` | Update | Add recharts dependency |
| `apps/web/src/hooks/useFeatureFlag.ts` | New | Feature flag hooks |
| `apps/web/src/hooks/useViewport.ts` | New | Viewport + layout mode hooks |
| `apps/web/src/hooks/useAnalytics.ts` | New | Analytics data hooks |
| `apps/web/src/components/Charts.tsx` | New | Chart wrappers (Bar, Pie, etc.) |
| `apps/web/src/routes/supervisor/Analytics.tsx` | New | Main analytics dashboard |
| `apps/web/src/routes/admin/FeatureFlags.tsx` | New | Feature flag management |
| `apps/web/src/App.tsx` | Update | Add new routes |
| `apps/web/src/routes/supervisor/Dashboard.tsx` | Update | Add analytics link (feature-gated) |
| `apps/web/src/routes/admin/Projects.tsx` | Update | Add feature flags nav button |

## Next Steps

1. Apply migrations to your Supabase instance
2. Install dependencies: `pnpm install && pnpm build`
3. Test locally: `pnpm dev` and navigate to analytics
4. Enable feature flag for supervisors at `/admin/feature-flags`
5. Gather feedback from pilot users
6. Adjust filters, chart styles, or data range based on feedback
7. Roll out to wider team

---

**Questions?** See `plan.md` section 23 for detailed feature requirements.

