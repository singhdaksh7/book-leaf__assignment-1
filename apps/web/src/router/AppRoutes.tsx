import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { AppLayout } from "../components/layout/AppLayout";
import { LoginPage } from "../pages/auth/LoginPage";
import { RegisterPage } from "../pages/auth/RegisterPage";
import { DashboardPage } from "../pages/author/DashboardPage";
import { BooksPage } from "../pages/author/BooksPage";
import { BookDetailPage } from "../pages/author/BookDetailPage";
import { TicketsPage } from "../pages/author/TicketsPage";
import { NewTicketPage } from "../pages/author/NewTicketPage";
import { TicketDetailPage } from "../pages/author/TicketDetailPage";
import { AdminDashboardPage } from "../pages/admin/AdminDashboardPage";
import { AdminQueuePage } from "../pages/admin/AdminQueuePage";
import { AdminTicketDetailPage } from "../pages/admin/AdminTicketDetailPage";
import { NotFoundPage } from "../pages/NotFoundPage";

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Route */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected Routes (Author & Shared Workspace) */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="books" element={<BooksPage />} />
        <Route path="books/:bookId" element={<BookDetailPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="tickets/new" element={<NewTicketPage />} />
        <Route path="tickets/:ticketId" element={<TicketDetailPage />} />

        {/* Admin Console Routes (Restricted to ADMIN role) */}
        <Route
          path="admin/dashboard"
          element={
            <ProtectedRoute requiredRole="ADMIN">
              <AdminDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/queue"
          element={
            <ProtectedRoute requiredRole="ADMIN">
              <AdminQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/tickets/:ticketId"
          element={
            <ProtectedRoute requiredRole="ADMIN">
              <AdminTicketDetailPage />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* 404 Catch-all */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
};
