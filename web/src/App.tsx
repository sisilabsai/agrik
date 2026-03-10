import { useMemo } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./state/auth";
import { useAdminAuth } from "./state/adminAuth";
import Landing from "./pages/Landing";
import AuthPage from "./pages/AuthPage";
import AdminDashboard from "./pages/AdminDashboard";
import AdminLayout from "./pages/AdminLayout";
import AdminLogin from "./pages/AdminLogin";
import AdminUsers from "./pages/AdminUsers";
import AdminListings from "./pages/AdminListings";
import AdminPrices from "./pages/AdminPrices";
import AdminAlerts from "./pages/AdminAlerts";
import AdminServices from "./pages/AdminServices";
import AdminActivity from "./pages/AdminActivity";
import AppLayout from "./pages/Layout";
import FarmerLayout from "./pages/FarmerLayout";
import FarmerOverview from "./pages/FarmerOverview";
import FarmerFarm from "./pages/FarmerFarm";
import FarmerFarmHome from "./pages/FarmerFarmHome";
import FarmerFarmCreate from "./pages/FarmerFarmCreate";
import FarmerFarmManage from "./pages/FarmerFarmManage";
import FarmerFarmSettings from "./pages/FarmerFarmSettings";
import FarmerMarketHub from "./pages/FarmerMarketHub";
import FarmerServices from "./pages/FarmerServices";
import FarmerSubscriptions from "./pages/FarmerSubscriptions";
import FarmerBrain from "./pages/FarmerBrain";
import FarmerHistory from "./pages/FarmerHistory";
import BuyerLayout from "./pages/BuyerLayout";
import BuyerDashboard from "./pages/BuyerDashboard";
import BuyerMarketplace from "./pages/BuyerMarketplace";
import ProviderLayout from "./pages/ProviderLayout";
import ProviderDashboard from "./pages/ProviderDashboard";
import ProviderMarketplace from "./pages/ProviderMarketplace";
import ProviderLeads from "./pages/ProviderLeads";
import ProviderMarketing from "./pages/ProviderMarketing";
import PublicMarketplace from "./pages/PublicMarketplace";
import PublicListingDetails from "./pages/PublicListingDetails";
import PwaInstallPrompt from "./components/PwaInstallPrompt";

export default function App() {
  const { user, loading } = useAuth();
  const { admin, loading: adminLoading } = useAdminAuth();
  const isAuthed = !!user;
  const isAdminAuthed = !!admin;
  const isAdminRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  const isProviderRole = user?.role === "service_provider" || user?.role === "input_supplier";
  const isBuyerRole = user?.role === "buyer" || user?.role === "offtaker";

  const defaultPath = useMemo(() => {
    if (!isAuthed) return "/";
    if (isProviderRole) return "/provider";
    if (isBuyerRole) return "/buyer";
    return "/dashboard";
  }, [isAuthed, isBuyerRole, isProviderRole]);

  if (loading || (isAdminRoute && adminLoading)) {
    return (
      <div className="app-shell">
        <main className="page">Loading session...</main>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <PwaInstallPrompt />
      <Routes>
        <Route path="/admin/login" element={isAdminAuthed ? <Navigate to="/admin" /> : <AdminLogin />} />
        <Route path="/admin" element={isAdminAuthed ? <AdminLayout /> : <Navigate to="/admin/login" />}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="listings" element={<AdminListings />} />
          <Route path="prices" element={<AdminPrices />} />
          <Route path="alerts" element={<AdminAlerts />} />
          <Route path="services" element={<AdminServices />} />
          <Route path="activity" element={<AdminActivity />} />
        </Route>
        <Route
          path="/dashboard"
          element={isAuthed ? (isBuyerRole || isProviderRole ? <Navigate to={defaultPath} /> : <FarmerLayout />) : <Navigate to="/auth" />}
        >
          <Route index element={<FarmerOverview />} />
          <Route path="farm" element={<FarmerFarm />}>
            <Route index element={<FarmerFarmHome />} />
            <Route path="create" element={<FarmerFarmCreate />} />
            <Route path="manage" element={<FarmerFarmManage />} />
            <Route path="settings" element={<FarmerFarmSettings />} />
          </Route>
          <Route path="market" element={<FarmerMarketHub />} />
          <Route path="services" element={<FarmerServices />} />
          <Route path="subscriptions" element={<FarmerSubscriptions />} />
          <Route path="brain" element={<FarmerBrain />} />
          <Route path="history" element={<FarmerHistory />} />
        </Route>
        <Route path="/buyer" element={isAuthed && isBuyerRole ? <BuyerLayout /> : <Navigate to={defaultPath} />}>
          <Route index element={<BuyerDashboard />} />
          <Route path="market" element={<BuyerMarketplace />} />
        </Route>
        <Route path="/provider" element={isAuthed && isProviderRole ? <ProviderLayout /> : <Navigate to={defaultPath} />}>
          <Route index element={<ProviderDashboard />} />
          <Route path="services" element={<ProviderMarketplace />} />
          <Route path="leads" element={<ProviderLeads />} />
          <Route path="marketing" element={<ProviderMarketing />} />
          <Route path="market" element={<Navigate to="/provider/services" replace />} />
        </Route>
        <Route element={<AppLayout />}>
          <Route path="/" element={isAuthed ? <Navigate to={defaultPath} /> : <Landing />} />
          <Route path="/marketplace" element={<PublicMarketplace />} />
          <Route path="/marketplace/listings/:listingId" element={<PublicListingDetails />} />
          <Route path="/auth" element={isAuthed ? <Navigate to={defaultPath} /> : <AuthPage />} />
        </Route>
        <Route path="*" element={<Navigate to={defaultPath} />} />
      </Routes>
    </BrowserRouter>
  );
}
