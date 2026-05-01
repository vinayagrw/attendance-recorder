import { Routes, Route, Navigate } from 'react-router-dom'
import { useTrafficLogger } from './hooks/useTrafficLogger'
import HomeRouter from './routes/HomeRouter'
import WorkerLogin from './routes/worker/Login'
import WorkerRegister from './routes/worker/Register'
import WorkerPunch from './routes/worker/Punch'
import WorkerHistory from './routes/worker/History'
import WorkerPending from './routes/worker/Pending'
import SupervisorLogin from './routes/supervisor/Login'
import SupervisorDashboard from './routes/supervisor/Dashboard'
import SupervisorApprovals from './routes/supervisor/Approvals'
import SupervisorReports from './routes/supervisor/Reports'
import SupervisorReportsList from './routes/supervisor/ReportsList'
import SupervisorDailyReport from './routes/supervisor/DailyReport'
import SupervisorDailyReportsList from './routes/supervisor/DailyReportsList'
import SupervisorInviteWorker from './routes/supervisor/InviteWorker'
import SupervisorManualPunch from './routes/supervisor/ManualPunch'
import SupervisorEditPunch from './routes/supervisor/EditPunch'
import SupervisorPinResets from './routes/supervisor/PinResets'
import SupervisorBriefings from './routes/supervisor/Briefings'
import SupervisorAnalytics from './routes/supervisor/Analytics'
import WorkerForgotPin from './routes/worker/ForgotPin'
import InstallPrompt from './components/InstallPrompt'
import ErrorBoundary from './components/ErrorBoundary'
import AdminProjects from './routes/admin/Projects'
import AdminFeatureFlags from './routes/admin/FeatureFlags'
import AdminSites from './routes/admin/Sites'
import AdminWorkers from './routes/admin/Workers'
import AdminAudit from './routes/admin/Audit'
import AdminDiagnostics from './routes/admin/Diagnostics'
import AdminTraffic from './routes/admin/Traffic'
import NotFound from './routes/NotFound'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  // Site-traffic monitoring — fires a page_view access_event on every route
  // change, tagged with the current actor (worker / supervisor / admin / anon).
  useTrafficLogger()

  return (
    <Routes>
      <Route path="/" element={<HomeRouter />} />

      {/* Worker (synthetic email Supabase Auth — see plan §22) */}
      <Route path="/worker">
        <Route index element={<Navigate to="/worker/login" replace />} />
        <Route path="login" element={<WorkerLogin />} />
        <Route path="register" element={<WorkerRegister />} />
        <Route path="forgot-pin" element={<WorkerForgotPin />} />
        <Route path="pending" element={<WorkerPending />} />
        <Route path="punch" element={<WorkerPunch />} />
        <Route path="history" element={<WorkerHistory />} />
      </Route>

      {/* Supervisor — login is public; rest require a logged-in supervisor */}
      <Route path="/supervisor">
        <Route index element={<Navigate to="/supervisor/login" replace />} />
        <Route path="login" element={<SupervisorLogin />} />
        <Route element={<ProtectedRoute />}>
          <Route path="dashboard" element={<SupervisorDashboard />} />
          <Route path="approvals" element={<SupervisorApprovals />} />
          <Route path="reports" element={<SupervisorReports />} />
          <Route path="reports-list" element={<SupervisorReportsList />} />
          <Route path="daily-report" element={<SupervisorDailyReport />} />
          <Route path="daily-reports-list" element={<SupervisorDailyReportsList />} />
          <Route path="invite-worker" element={<SupervisorInviteWorker />} />
          <Route path="manual-punch" element={<SupervisorManualPunch />} />
           <Route path="edit-punch/:id" element={<SupervisorEditPunch />} />
           <Route path="pin-resets" element={<SupervisorPinResets />} />
           <Route path="briefings" element={<SupervisorBriefings />} />
           <Route path="analytics" element={<SupervisorAnalytics />} />
        </Route>
      </Route>

      {/* Admin — admin-only role gate */}
      <Route path="/admin" element={<ProtectedRoute requiredRole="admin" />}>
        <Route index element={<Navigate to="/admin/projects" replace />} />
       <Route path="projects" element={<AdminProjects />} />
         <Route path="sites" element={<AdminSites />} />
         <Route path="workers" element={<AdminWorkers />} />
         <Route path="audit" element={<AdminAudit />} />
         <Route path="diagnostics" element={<AdminDiagnostics />} />
         <Route path="feature-flags" element={<AdminFeatureFlags />} />
         <Route path="traffic" element={<AdminTraffic />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export function AppWithChrome() {
  return (
    <ErrorBoundary>
      <App />
      <InstallPrompt />
    </ErrorBoundary>
  )
}
