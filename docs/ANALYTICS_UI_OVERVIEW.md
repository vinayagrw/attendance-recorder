# Analytics Dashboard UI Overview

## Main Analytics Page (`/supervisor/analytics`)

```
┌─────────────────────────────────────────────────────────────────┐
│ Analytical Dashboard                                      [Back] │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ Filters & View                            [📱 Mobile] ► │    │
│ │                                                           │    │
│ │ [From: 2026-04-01] [To: 2026-05-01]                    │    │
│ │ [Project: ▼ All projects] [Reset filters]              │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│ ┌──────────────────────┐  ┌──────────────────────┐              │
│ │ 📊 Hours per Project │  │ 👥 Active Workers    │ (Desktop)   │
│ │                      │  │    per Project       │  or         │
│ │ [Bar Chart]          │  │ [Bar Chart]          │  (Mobile)   │
│ │ - Project A: 160h    │  │ - Project A: 8      │              │
│ │ - Project B: 120h    │  │ - Project B: 6      │              │
│ │ - Project C:  80h    │  │ - Project C: 4      │              │
│ └──────────────────────┘  └──────────────────────┘              │
│                                                                   │
│ ┌──────────────────────┐  ┌──────────────────────┐              │
│ │ 🥧 Hours Distribution│  │ 🥧 Worker Distribution
│ │    by Project        │  │    by Project        │              │
│ │ [Pie Chart]          │  │ [Pie Chart]          │              │
│ │ - A: 40%             │  │ - A: 42%             │              │
│ │ - B: 30%             │  │ - B: 35%             │              │
│ │ - C: 30%             │  │ - C: 23%             │              │
│ └──────────────────────┘  └──────────────────────┘              │
│                                                                   │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ ⭐ Top Workers by Hours (Last 15)                        │    │
│ │ [Horizontal Bar Chart]                                    │    │
│ │ - Ravi Kumar (Project A): 45h ============>              │    │
│ │ - Priya Singh (Project B): 38h ==========>               │    │
│ │ - Anil Yadav (Project A): 35h ========>                  │    │
│ │ - Arjun Patel (Project C): 28h ======>                   │    │
│ │ - Deepika Roy (Project B): 22h =====>                    │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ 📅 Daily Attendance                                      │    │
│ ├──────────────────────────────────────────────────────────┤    │
│ │ Date  │ Worker        │ Project   │ In    │ Out  │ Hours│    │
│ ├───────┼───────────────┼───────────┼───────┼──────┼──────┤    │
│ │ 05-01 │ Ravi Kumar    │ Project A │ 09:00 │17:00 │  8.0│    │
│ │ 05-01 │ Priya Singh   │ Project B │ 08:30 │17:30 │  9.0│    │
│ │ 04-30 │ Anil Yadav    │ Project C │ 09:15 │16:45 │  7.5│    │
│ │ 04-30 │ Ravi Kumar    │ Project A │ 10:00 │18:30 │  8.5│    │
│ │ ...   │ ...           │ ...       │ ...   │ ...  │ ... │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Mobile View (When "📱 Mobile" Selected)

```
┌─────────────────────────────────┐
│ Analytical Dashboard   [🖥 Desk. │
├─────────────────────────────────┤
│                                  │
│ Filters & View                   │
│ [From: ▼] [To: ▼]              │
│ [Project: ▼]                    │
│ [Reset filters]                 │
│                                  │
│ ┌────────────────────────────┐  │
│ │ 📊 Hours per Project       │  │
│ │ [Bar Chart - 1 col]        │  │
│ └────────────────────────────┘  │
│                                  │
│ ┌────────────────────────────┐  │
│ │ 👥 Active Workers          │  │
│ │    per Project             │  │
│ │ [Bar Chart - 1 col]        │  │
│ └────────────────────────────┘  │
│                                  │
│ ┌────────────────────────────┐  │
│ │ 🥧 Hours Distribution      │  │
│ │ [Pie Chart - 1 col]        │  │
│ └────────────────────────────┘  │
│                                  │
│ ┌────────────────────────────┐  │
│ │ 🥧 Worker Distribution     │  │
│ │ [Pie Chart - 1 col]        │  │
│ └────────────────────────────┘  │
│                                  │
│ ┌────────────────────────────┐  │
│ │ ⭐ Top Workers            │  │
│ │ [Horiz. Bar - scrollable]  │  │
│ └────────────────────────────┘  │
│                                  │
│ ┌────────────────────────────┐  │
│ │ 📅 Daily Attendance        │  │
│ │ [Table - horiz. scroll]    │  │
│ │ Date │ Worker │ In │ Out  │  │
│ │ ...  │ ...    │... │ ...  │  │
│ └────────────────────────────┘  │
│                                  │
└─────────────────────────────────┘
```

---

## Feature Flags Admin Page (`/admin/feature-flags`)

```
┌───────────────────────────────────────────────────────────┐
│ Feature Flags                                    [Back]   │
├───────────────────────────────────────────────────────────┤
│                                                           │
│ Control feature visibility and gradual rollouts.         │
│ Changes take effect immediately.                         │
│                                                           │
│ ┌───────────────────────────────────────────────────┐    │
│ │ Analytical Dashboard                  [✓ Enabled] │    │
│ │ View hours, charts, and worker analytics          │    │
│ │ Key: analytics_dashboard                          │    │
│ └───────────────────────────────────────────────────┘    │
│                                                           │
│ ┌───────────────────────────────────────────────────┐    │
│ │ Advanced Filters                     [✓ Enabled] │    │
│ │ Use advanced filters in reports                   │    │
│ │ Key: advanced_filters                            │    │
│ └───────────────────────────────────────────────────┘    │
│                                                           │
│ ┌───────────────────────────────────────────────────┐    │
│ │ Daily Attendance Table               [✓ Enabled] │    │
│ │ View daily attendance in tabular format           │    │
│ │ Key: daily_attendance_table                       │    │
│ └───────────────────────────────────────────────────┘    │
│                                                           │
│ ┌───────────────────────────────────────────────────┐    │
│ │ Chart Exports                        [○ Disabled] │    │
│ │ Export charts as images (coming soon)             │    │
│ │ Key: chart_exports                               │    │
│ └───────────────────────────────────────────────────┘    │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## Supervisor Dashboard Update

```
┌──────────────────────────────────────────┐
│ Dashboard                        [Sign out]
├──────────────────────────────────────────┤
│                                            │
│ Navigation Grid (2 cols, or 1 on mobile):  │
│                                            │
│ ┌──────────────┐  ┌──────────────┐       │
│ │ Approvals    │  │ Reports      │       │
│ │      3       │  │    📋        │       │
│ └──────────────┘  └──────────────┘       │
│                                            │
│ ┌──────────────┐  ┌──────────────┐       │
│ │ Payroll CSV  │  │ Daily Report │       │
│ │     ⬇        │  │      1       │       │
│ └──────────────┘  └──────────────┘       │
│                                            │
│ ┌──────────────┐  ┌──────────────┐       │
│ │ + Invite     │  │ + Manual     │       │
│ │   worker     │  │   punch      │       │
│ └──────────────┘  └──────────────┘       │
│                                            │
│ ┌──────────────┐  ┌──────────────┐       │
│ │ ✏ Briefings  │  │ 🔑 PIN Resets│       │
│ └──────────────┘  └──────────────┘       │
│                                            │
│ ┌──────────────────────────────┐         │
│ │ 📋 Browse daily reports      │         │
│ └──────────────────────────────┘         │
│                                            │
│ ┌──────────────────────────────┐         │
│ │ 📊 Analytics ◄── NEW (if      │         │
│ │               enabled)         │         │
│ └──────────────────────────────┘         │
│                                            │
├──────────────────────────────────────────┤
│ ... [Anomalies & Today's Punches] ...   │
│                                            │
└──────────────────────────────────────────┘
```

---

## Data Flow

```
Supervisor opens /supervisor/analytics
         │
         ▼
useFeatureFlag('analytics_dashboard')
         │
    ┌────┴────┐
    │          │
  YES         NO
    │          │
    ▼          ▼
 Load     Show "Feature
 Data     not enabled"
    │
    ├─ useAnalyticsHoursPerProject()
    │  (RPC: analytics_hours_per_project)
    │
    ├─ useAnalyticsHoursPerWorkerProject()
    │  (RPC: analytics_hours_per_worker_project)
    │
    ├─ useAnalyticsWorkerCountPerProject()
    │  (RPC: analytics_worker_count_per_project)
    │
    └─ useAnalyticsDailyAttendance()
       (RPC: analytics_daily_attendance)
         │
         ▼
    Render Charts
    + Table
```

---

## Responsive Breakpoints

| Screen Size | Layout | Behavior |
|---|---|---|
| **< 768px** (mobile) | 1 column | Single stack, touch-friendly buttons |
| **768–1024px** (tablet) | 1–2 columns | Flexible stacking |
| **≥ 1024px** (desktop) | 2–4 columns | Side-by-side charts |

**Manual Override**: Toggle button in top-right overrides viewport size preference.

---

## Error States

### No Data
```
┌────────────────────────────────┐
│ 📊 Hours per Project           │
│                                │
│ No data for selected period.   │
│ Try extending the date range.  │
└────────────────────────────────┘
```

### Data Load Error
```
┌────────────────────────────────────────┐
│ Failed to load some data:              │
│ • Function analytics_hours_per_project  │
│   error                                │
│                                        │
│ Please try again or contact support.  │
└────────────────────────────────────────┘
```

### Feature Disabled
```
┌────────────────────────────────────────┐
│ The analytics dashboard is not         │
│ enabled yet.                           │
│                                        │
│ Contact your administrator to enable   │
│ this feature.                          │
└────────────────────────────────────────┘
```

---

## Interaction Examples

### Example 1: Filter by Project
User selects "Project A" in dropdown
→ All 4 charts + table re-query with `p_project_id = <id>`
→ Hours/worker chart updates to show only Project A's workers
→ Table filters to show only Project A's punches

### Example 2: Toggle Mobile Mode
User clicks "📱 Mobile"
→ Layout changes from `grid-cols-4` to `grid-cols-1`
→ Preference saved to localStorage
→ Tables become horizontally scrollable

### Example 3: Change Date Range
User picks "Last 7 days" instead of "Last 30 days"
→ All queries refetch with new `p_start` / `p_end`
→ Charts animate to new values
→ Table shows only records from selected date range

### Example 4: Admin enables Feature
Admin toggles flag at `/admin/feature-flags`
→ Feature flag cache invalidates (5 min TTL)
→ Supervisor sees "Analytics" tile on dashboard
→ Can now navigate to `/supervisor/analytics`


