import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { Layout } from './components/Layout';
import { AdminRouteGuard, CandidateRouteGuard } from './components/RouteGuards';
import { DeviceCheck } from './components/DeviceCheck';

// Page components
import { StartPage } from './pages/StartPage';
import { InstructionsPage } from './pages/InstructionsPage';
import { TestPage } from './pages/TestPage';
import { DonePage } from './pages/DonePage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminCandidateDetailPage } from './pages/AdminCandidateDetailPage';
import { AdminCodesPage } from './pages/AdminCodesPage';
import { AdminQuestionsPage } from './pages/AdminQuestionsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Layout>
          <Routes>
            {/* Public Candidate Entry Route with Device Check */}
            <Route
              path="/"
              element={
                <DeviceCheck>
                  <StartPage />
                </DeviceCheck>
              }
            />

            {/* Admin Login Route */}
            <Route path="/admin/login" element={<AdminLoginPage />} />

            {/* Candidate Protected Routes with Device Check */}
            <Route
              path="/instructions"
              element={
                <DeviceCheck>
                  <CandidateRouteGuard mode="instructions">
                    <InstructionsPage />
                  </CandidateRouteGuard>
                </DeviceCheck>
              }
            />
            <Route
              path="/test"
              element={
                <DeviceCheck>
                  <CandidateRouteGuard mode="test">
                    <TestPage />
                  </CandidateRouteGuard>
                </DeviceCheck>
              }
            />
            <Route
              path="/done"
              element={
                <CandidateRouteGuard mode="done">
                  <DonePage />
                </CandidateRouteGuard>
              }
            />

            {/* Admin Protected Routes */}
            <Route
              path="/admin"
              element={
                <AdminRouteGuard>
                  <AdminDashboardPage />
                </AdminRouteGuard>
              }
            />
            <Route
              path="/admin/candidates/:id"
              element={
                <AdminRouteGuard>
                  <AdminCandidateDetailPage />
                </AdminRouteGuard>
              }
            />
            <Route
              path="/admin/codes"
              element={
                <AdminRouteGuard>
                  <AdminCodesPage />
                </AdminRouteGuard>
              }
            />
            <Route
              path="/admin/questions"
              element={
                <AdminRouteGuard>
                  <AdminQuestionsPage />
                </AdminRouteGuard>
              }
            />

            {/* Unknown URLs fallback to 404 */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Layout>
      </HashRouter>
    </AuthProvider>
  );
}
