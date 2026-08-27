/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useLayoutEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  bootstrapFirstAdmin,
  fetchFirstAdminBootstrapStatus,
} from "../../api/auth";
import BrandMark from "../../components/BrandMark";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { PRODUCT_NAME } from "../../constants/product";
import { extractApiError } from "../../utils/apiError";

const inputClasses =
  "mt-1 w-full rounded-xl border border-slate-200/90 bg-white/90 px-3 py-2.5 ui-body text-slate-800 shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
const buttonClasses =
  "w-full rounded-xl bg-primary px-4 py-2.5 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60";

function readBootstrapTokenFragment(): string {
  if (typeof window === "undefined") return "";
  const fragment = window.location.hash.replace(/^#/, "");
  return new URLSearchParams(fragment).get("token")?.trim() ?? "";
}

function clearBootstrapTokenFragment(): void {
  if (typeof window === "undefined") return;
  if (window.location.hash) {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }
}

export default function FirstAdminSetupPage() {
  const navigate = useNavigate();
  const [token] = useState(readBootstrapTokenFragment);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    clearBootstrapTokenFragment();
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchFirstAdminBootstrapStatus()
      .then((status) => {
        if (!mounted) return;
        if (!status.available) {
          navigate("/login", { replace: true });
          return;
        }
        if (!token) {
          setError(
            "The bootstrap token is missing. Open the complete one-time URL issued by the backend.",
          );
        }
      })
      .catch((statusError) => {
        if (mounted) {
          setError(
            extractApiError(
              statusError,
              "Unable to check bootstrap availability.",
            ),
          );
        }
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, [navigate, token]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError(
        "The bootstrap token is missing. Issue a new one-time URL from the backend.",
      );
      return;
    }
    if (password !== passwordConfirmation) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await bootstrapFirstAdmin(token, {
        email: email.trim(),
        full_name: fullName.trim() || null,
        password,
        password_confirmation: passwordConfirmation,
      });
      if (response.status !== "mfa_enrollment_required") {
        throw new Error("Administrator passkey enrollment was not started.");
      }
      navigate("/login?mfa=mfa_enrollment_required", { replace: true });
    } catch (submitError) {
      setError(
        extractApiError(
          submitError,
          "The bootstrap link is invalid, expired, or already used.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-7rem] h-80 w-80 rounded-full bg-primary-500/20 blur-3xl" />
        <div className="auth-brand-glow-coral absolute -right-24 bottom-[-7rem] h-96 w-96 rounded-full blur-3xl" />
        <div className="auth-brand-radial absolute inset-0" />
      </div>
      <section className="relative w-full max-w-lg rounded-3xl bg-white p-7 text-slate-900 shadow-2xl sm:p-8">
        <BrandMark alt={PRODUCT_NAME} className="mb-5 h-16 w-16" />
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary-700">
          Initial setup
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          Create the first administrator
        </h1>
        <p className="mt-3 ui-body text-slate-600">
          This one-time setup creates the platform super-administrator. A
          passkey will be required immediately afterward.
        </p>

        {error ? (
          <div className="mt-5">
            <UiInlineMessage tone="error">{error}</UiInlineMessage>
          </div>
        ) : null}

        {checking ? (
          <p className="mt-6 ui-body text-slate-600">
            Checking the bootstrap link…
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label
              className="block ui-body font-medium"
              htmlFor="bootstrap-full-name"
            >
              Full name
              <input
                id="bootstrap-full-name"
                className={inputClasses}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </label>
            <label
              className="block ui-body font-medium"
              htmlFor="bootstrap-email"
            >
              Email
              <input
                id="bootstrap-email"
                className={inputClasses}
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
              />
            </label>
            <div>
              <label
                className="block ui-body font-medium"
                htmlFor="bootstrap-password"
              >
                Password
              </label>
              <input
                id="bootstrap-password"
                className={inputClasses}
                type="password"
                required
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                aria-describedby="bootstrap-password-help"
              />
              <span
                id="bootstrap-password-help"
                className="mt-1 block ui-caption text-slate-500"
              >
                Use at least 12 characters.
              </span>
            </div>
            <label
              className="block ui-body font-medium"
              htmlFor="bootstrap-password-confirmation"
            >
              Confirm password
              <input
                id="bootstrap-password-confirmation"
                className={inputClasses}
                type="password"
                required
                minLength={12}
                value={passwordConfirmation}
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
                autoComplete="new-password"
              />
            </label>
            <button
              type="submit"
              className={buttonClasses}
              disabled={
                submitting ||
                !token ||
                !email.trim() ||
                password.length < 12 ||
                passwordConfirmation.length < 12
              }
            >
              {submitting
                ? "Creating administrator…"
                : "Create administrator"}
            </button>
          </form>
        )}
        <p className="mt-5 ui-caption text-slate-500">
          Already initialized?{" "}
          <Link className="font-semibold text-primary-700" to="/login">
            Return to sign in
          </Link>
        </p>
      </section>
    </div>
  );
}
