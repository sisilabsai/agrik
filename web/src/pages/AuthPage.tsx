import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../state/auth";
import {
  api,
  type OnboardingOptionsOut,
  type OnboardingRoleOptionOut,
  type ServiceCategoryOptionOut,
  type UgandaDistrictOut,
  type UgandaParishOut,
} from "../lib/api";

type StatusMessage = { type: "info" | "error"; message: string };

type PhoneCheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; normalized: string }
  | { state: "taken"; normalized: string }
  | { state: "invalid"; message: string };

type AuthMode = "login" | "register";

const FALLBACK_ROLE_OPTIONS: OnboardingRoleOptionOut[] = [
  {
    id: "farmer",
    label: "Farmer",
    description: "Sell produce and receive digital advisory.",
    required_fields: ["full_name", "phone", "district", "parish", "crops"],
  },
  {
    id: "service_provider",
    label: "Service provider",
    description: "Offer mechanization, spraying, transport, and related services.",
    required_fields: ["full_name", "phone", "district", "parish", "organization_name", "service_categories"],
  },
  {
    id: "input_supplier",
    label: "Input supplier",
    description: "Provide seeds, fertilizer, agrochemicals, and tools.",
    required_fields: ["full_name", "phone", "district", "parish", "organization_name", "service_categories"],
  },
  {
    id: "buyer",
    label: "Buyer",
    description: "Buy produce from farmers and publish demand.",
    required_fields: ["full_name", "phone", "district", "parish", "organization_name", "focus_crops"],
  },
  {
    id: "offtaker",
    label: "Offtaker",
    description: "Run structured procurement and contract sourcing.",
    required_fields: ["full_name", "phone", "district", "parish", "organization_name", "focus_crops"],
  },
];

const FALLBACK_CROPS = ["maize", "beans", "cassava", "groundnut", "banana", "coffee", "rice", "sorghum", "millet"];

const FALLBACK_SERVICE_CATEGORIES: ServiceCategoryOptionOut[] = [
  { id: "mechanization", label: "Mechanization" },
  { id: "transport", label: "Transport" },
  { id: "spraying", label: "Spraying" },
  { id: "storage", label: "Storage" },
  { id: "aggregation", label: "Aggregation" },
  { id: "extension", label: "Extension advisory" },
  { id: "finance", label: "Financial services" },
];

function normalizeSelection(value: string) {
  return value.trim().toLowerCase();
}

export default function AuthPage() {
  const { login, register, verify } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");

  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [fullName, setFullName] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [role, setRole] = useState("farmer");
  const [district, setDistrict] = useState("");
  const [parish, setParish] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [crops, setCrops] = useState<string[]>([]);
  const [serviceCategories, setServiceCategories] = useState<string[]>([]);
  const [focusCrops, setFocusCrops] = useState<string[]>([]);

  const [otpRequired, setOtpRequired] = useState(false);
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpContext, setOtpContext] = useState<"login" | "register" | null>(null);

  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [phoneCheck, setPhoneCheck] = useState<PhoneCheckState>({ state: "idle" });

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingParishes, setLoadingParishes] = useState(false);
  const [districts, setDistricts] = useState<UgandaDistrictOut[]>([]);
  const [parishes, setParishes] = useState<UgandaParishOut[]>([]);
  const [onboardingOptions, setOnboardingOptions] = useState<OnboardingOptionsOut | null>(null);

  const parseError = (err: unknown) => {
    if (!err || typeof err !== "object") return "Request failed. Try again.";
    const detail = (err as { detail?: string }).detail;
    return detail || "Request failed. Try again.";
  };

  const roleOptions = onboardingOptions?.roles?.length ? onboardingOptions.roles : FALLBACK_ROLE_OPTIONS;
  const cropOptions = onboardingOptions?.crops?.length ? onboardingOptions.crops : FALLBACK_CROPS;
  const categoryOptions = onboardingOptions?.service_categories?.length
    ? onboardingOptions.service_categories
    : FALLBACK_SERVICE_CATEGORIES;

  const selectedRole = useMemo(() => roleOptions.find((item) => item.id === role) ?? roleOptions[0], [role, roleOptions]);
  const isFarmer = role === "farmer";
  const needsOrganization = role !== "farmer";
  const needsServiceCategories = role === "service_provider" || role === "input_supplier";
  const needsFocusCrops = role === "buyer" || role === "offtaker";

  useEffect(() => {
    if (role === "farmer") {
      setOrganizationName("");
      setServiceCategories([]);
      setFocusCrops([]);
      return;
    }
    setCrops([]);
    if (role === "service_provider" || role === "input_supplier") {
      setFocusCrops([]);
      return;
    }
    setServiceCategories([]);
    setCrops([]);
  }, [role]);

  useEffect(() => {
    let active = true;
    const loadMetadata = async () => {
      setLoadingMeta(true);
      try {
        const [optionsRes, districtRes] = await Promise.all([api.onboardingOptions(), api.referenceDistricts()]);
        if (!active) return;
        setOnboardingOptions(optionsRes);
        setDistricts(districtRes.items ?? []);
        const defaultRole = optionsRes.default_role?.trim() || optionsRes.roles?.[0]?.id || "farmer";
        setRole(defaultRole);
      } catch (err) {
        if (!active) return;
        setStatus({ type: "error", message: parseError(err) });
      } finally {
        if (active) setLoadingMeta(false);
      }
    };
    loadMetadata();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadParishes = async () => {
      const districtValue = district.trim();
      if (!districtValue) {
        setParishes([]);
        setParish("");
        return;
      }
      setLoadingParishes(true);
      try {
        const response = await api.referenceParishes(districtValue);
        if (!active) return;
        const items = response.items ?? [];
        setParishes(items);
        if (!items.some((item) => item.id === parish || item.name === parish)) {
          setParish("");
        }
      } catch (err) {
        if (!active) return;
        setParishes([]);
        setStatus({ type: "error", message: parseError(err) });
      } finally {
        if (active) setLoadingParishes(false);
      }
    };
    loadParishes();
    return () => {
      active = false;
    };
  }, [district, parish]);

  const toggleSelection = (value: string, current: string[], setter: (next: string[]) => void) => {
    const key = normalizeSelection(value);
    const exists = current.some((item) => normalizeSelection(item) === key);
    if (exists) {
      setter(current.filter((item) => normalizeSelection(item) !== key));
      return;
    }
    setter([...current, value]);
  };

  const phoneStatusLabel = useMemo(() => {
    if (phoneCheck.state === "checking") return "Checking phone...";
    if (phoneCheck.state === "available") return `Available (${phoneCheck.normalized})`;
    if (phoneCheck.state === "taken") return `Already registered (${phoneCheck.normalized})`;
    if (phoneCheck.state === "invalid") return phoneCheck.message;
    return "";
  }, [phoneCheck]);

  function ensureLoginPhone() {
    if (!loginPhone.trim()) {
      setStatus({ type: "error", message: "Enter your phone number." });
      return false;
    }
    return true;
  }

  function ensureRegisterPhone() {
    if (!registerPhone.trim()) {
      setStatus({ type: "error", message: "Enter a phone number to continue." });
      return false;
    }
    return true;
  }

  function validateRegistration() {
    if (!ensureRegisterPhone()) return false;
    if (!fullName.trim()) {
      setStatus({ type: "error", message: "Enter your full name." });
      return false;
    }
    if (registerPassword.trim().length < 6) {
      setStatus({ type: "error", message: "Use a password with at least 6 characters." });
      return false;
    }
    if (!district.trim()) {
      setStatus({ type: "error", message: "Select your district." });
      return false;
    }
    if (!parish.trim()) {
      setStatus({ type: "error", message: "Select your parish." });
      return false;
    }
    if (isFarmer && crops.length === 0) {
      setStatus({ type: "error", message: "Select at least one crop." });
      return false;
    }
    if (needsOrganization && !organizationName.trim()) {
      setStatus({ type: "error", message: "Enter your organization name." });
      return false;
    }
    if (needsServiceCategories && serviceCategories.length === 0) {
      setStatus({ type: "error", message: "Select at least one service category." });
      return false;
    }
    if (needsFocusCrops && focusCrops.length === 0) {
      setStatus({ type: "error", message: "Select at least one focus crop." });
      return false;
    }
    return true;
  }

  const checkPhone = async () => {
    if (!ensureRegisterPhone()) return null;
    setPhoneCheck({ state: "checking" });
    try {
      const response = await api.authPhoneAvailability(registerPhone.trim());
      setPhoneCheck(response.available ? { state: "available", normalized: response.normalized_phone } : { state: "taken", normalized: response.normalized_phone });
      return response;
    } catch (err) {
      const message = parseError(err);
      setPhoneCheck({ state: "invalid", message });
      setStatus({ type: "error", message });
      return null;
    }
  };

  const handleRegister = async () => {
    if (!validateRegistration()) return;
    setStatus({ type: "info", message: "Checking phone number..." });
    const availability = await checkPhone();
    if (!availability) return;
    if (!availability.available) {
      setStatus({ type: "error", message: "This phone is already registered. Use Sign in instead." });
      setMode("login");
      setLoginPhone(registerPhone.trim());
      return;
    }
    setStatus({ type: "info", message: "Creating account..." });
    try {
      const result = await register({
        phone: registerPhone.trim(),
        password: registerPassword,
        role,
        full_name: fullName.trim(),
        district,
        parish,
        crops: isFarmer ? crops : undefined,
        organization_name: needsOrganization ? organizationName.trim() : undefined,
        service_categories: needsServiceCategories ? serviceCategories : undefined,
        focus_crops: needsFocusCrops ? focusCrops : undefined,
      });
      if (result === "logged_in") {
        setOtpRequired(false);
        setOtpContext(null);
        setStatus({ type: "info", message: "Account created." });
        return;
      }
      setOtpRequired(true);
      setOtpContext("register");
      setOtpPhone(registerPhone.trim());
      setStatus({ type: "info", message: "Enter the OTP sent to your phone." });
    } catch (err) {
      setStatus({ type: "error", message: parseError(err) });
    }
  };

  const handleLogin = async () => {
    if (!ensureLoginPhone()) return;
    setStatus({ type: "info", message: "Signing in..." });
    try {
      const result = await login(loginPhone.trim(), loginPassword.trim() || undefined);
      if (result === "logged_in") {
        setOtpRequired(false);
        setOtpContext(null);
        setStatus({ type: "info", message: "Signed in." });
        return;
      }
      setOtpRequired(true);
      setOtpContext("login");
      setOtpPhone(loginPhone.trim());
      setStatus({ type: "info", message: "Enter the OTP sent to your phone." });
    } catch (err) {
      setStatus({ type: "error", message: parseError(err) });
    }
  };

  const handleVerify = async () => {
    if (!otpPhone.trim()) {
      setStatus({ type: "error", message: "Missing phone number for OTP verification." });
      return;
    }
    if (!otpCode.trim()) {
      setStatus({ type: "error", message: "Enter the OTP code you received." });
      return;
    }
    setStatus({ type: "info", message: "Verifying OTP..." });
    try {
      await verify(otpPhone.trim(), otpCode.trim());
      setOtpRequired(false);
      setOtpContext(null);
      setStatus({ type: "info", message: "Verification complete." });
    } catch (err) {
      setStatus({ type: "error", message: parseError(err) });
    }
  };

  return (
    <div className="auth-page auth-page-modern auth-page-split">
      <div className="auth-mode-toggle">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
          Sign in
        </button>
        <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
          Create account
        </button>
      </div>

      <div className="auth-split-grid">
        <section className={`auth-card auth-card-modern auth-login-card${mode === "login" ? " is-active" : ""}`}>
          <div className="auth-panel-head">
            <div>
              <div className="label">Sign in</div>
              <h2>Access your AGRIK account</h2>
              <p>Use your phone number and password.</p>
            </div>
          </div>

          <div className="auth-form-grid auth-form-grid-login">
            <label className="field auth-span-2">
              Phone number
              <input
                placeholder="+2567..."
                value={loginPhone}
                onChange={(event) => setLoginPhone(event.target.value)}
              />
            </label>

            <label className="field auth-span-2">
              Password
              <input
                type="password"
                placeholder="Your password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
            </label>
          </div>

          <div className="auth-actions auth-actions-stacked">
            <button className="btn" onClick={handleLogin}>
              Sign in
            </button>
            <button className="btn ghost" onClick={() => setMode("register")}>
              Create account
            </button>
          </div>

          <article className="auth-insight-card compact">
            <div className="label">New here?</div>
            <p>Create a separate account with your role, district, parish, and crop or service profile.</p>
          </article>
        </section>

        <section className={`auth-card auth-card-modern auth-register-card${mode === "register" ? " is-active" : ""}`}>
          <div className="auth-panel-head">
            <div>
              <div className="label">Create account</div>
              <h2>Set up your profile</h2>
              <p>Choose a role, add your location, and complete the required profile details.</p>
            </div>
            <div className="auth-head-meta">
              <strong>{districts.length || "--"}</strong>
              <span>Districts loaded</span>
            </div>
          </div>

          <div className="auth-role-grid">
            {roleOptions.map((option) => {
              const active = option.id === role;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`auth-role-chip ${active ? "active" : ""}`}
                  onClick={() => setRole(option.id)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              );
            })}
          </div>

          <div className="auth-form-grid">
            <label className="field auth-span-2">
              Full name
              <input placeholder="Jane Adoch" value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>

            <label className="field auth-span-2">
              Phone number
              <div className="auth-inline-input">
                <input
                  placeholder="+2567..."
                  value={registerPhone}
                  onChange={(event) => {
                    setRegisterPhone(event.target.value);
                    setPhoneCheck({ state: "idle" });
                  }}
                />
                <button
                  type="button"
                  className="btn ghost auth-inline-btn"
                  onClick={checkPhone}
                  disabled={phoneCheck.state === "checking"}
                >
                  Check
                </button>
              </div>
            </label>

            <label className="field auth-span-2">
              Password
              <input
                type="password"
                placeholder="At least 6 characters"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
              />
            </label>

            {phoneStatusLabel ? (
              <p className={`auth-phone-status ${phoneCheck.state === "taken" || phoneCheck.state === "invalid" ? "error" : ""}`}>
                {phoneStatusLabel}
              </p>
            ) : null}

            <label className="field">
              District
              <select value={district} onChange={(event) => setDistrict(event.target.value)} disabled={loadingMeta}>
                <option value="">Select district</option>
                {districts.map((item) => (
                  <option key={item.id || item.name} value={item.id || item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Parish
              <select value={parish} onChange={(event) => setParish(event.target.value)} disabled={!district || loadingParishes}>
                <option value="">{loadingParishes ? "Loading parishes..." : "Select parish"}</option>
                {parishes.map((item) => (
                  <option key={item.id || `${item.name}-${item.subcounty}`} value={item.id || item.name}>
                    {item.subcounty ? `${item.name} (${item.subcounty})` : item.name}
                  </option>
                ))}
              </select>
            </label>

            {needsOrganization ? (
              <label className="field auth-span-2">
                Organization
                <input
                  placeholder="Company or cooperative name"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                />
              </label>
            ) : null}
          </div>

          {isFarmer ? (
            <div className="auth-selector-block">
              <p className="label">Crops</p>
              <div className="auth-chip-grid">
                {cropOptions.map((item) => {
                  const active = crops.includes(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`auth-data-chip ${active ? "active" : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleSelection(item, crops, setCrops)}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {needsServiceCategories ? (
            <div className="auth-selector-block">
              <p className="label">Service categories</p>
              <div className="auth-chip-grid">
                {categoryOptions.map((item) => {
                  const active = serviceCategories.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`auth-data-chip ${active ? "active" : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleSelection(item.id, serviceCategories, setServiceCategories)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {needsFocusCrops ? (
            <div className="auth-selector-block">
              <p className="label">Focus crops</p>
              <div className="auth-chip-grid">
                {cropOptions.map((item) => {
                  const active = focusCrops.includes(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`auth-data-chip ${active ? "active" : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleSelection(item, focusCrops, setFocusCrops)}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="auth-actions auth-actions-split">
            <button className="btn" onClick={handleRegister} disabled={loadingMeta}>
              Create account
            </button>
            <button className="btn ghost" onClick={() => setMode("login")}>
              Have an account?
            </button>
          </div>
        </section>
      </div>

      {otpRequired ? (
        <section className="auth-card auth-card-modern auth-otp-card">
          <div className="auth-panel-head">
            <div>
              <div className="label">{otpContext === "login" ? "Sign in verification" : "Account verification"}</div>
              <h2>Enter OTP</h2>
              <p>Use the code sent to {otpPhone || "your phone"}.</p>
            </div>
          </div>
          <div className="auth-form-grid auth-form-grid-login">
            <label className="field auth-span-2">
              OTP code
              <input placeholder="123456" value={otpCode} onChange={(event) => setOtpCode(event.target.value)} />
            </label>
          </div>
          <div className="auth-actions auth-actions-stacked">
            <button className="btn" onClick={handleVerify}>
              Verify OTP
            </button>
          </div>
        </section>
      ) : null}

      {status ? <p className={`status ${status.type === "error" ? "error" : ""}`}>{status.message}</p> : null}

      <aside className="auth-info auth-info-modern auth-info-split">
        <article className="auth-insight-card">
          <div className="label">Selected role</div>
          <h3>{selectedRole?.label ?? "Role"}</h3>
          <p>{selectedRole?.description ?? "Select a role to continue."}</p>
          <ul className="auth-inline-list">
            {(selectedRole?.required_fields ?? []).map((item) => (
              <li key={item}>{item.split("_").join(" ")}</li>
            ))}
          </ul>
        </article>

        <article className="auth-insight-card">
          <div className="label">Location data</div>
          <div className="auth-mini-grid">
            <div>
              <strong>{districts.length || "--"}</strong>
              <span>Districts</span>
            </div>
            <div>
              <strong>{parishes.length || "--"}</strong>
              <span>Parishes</span>
            </div>
          </div>
        </article>
      </aside>
    </div>
  );
}
