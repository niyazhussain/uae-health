const DEFAULT_PATIENT_PORTAL_HOST = "patient.uae-health.com";

function normalizedPatientHosts(configuredHosts?: string): Set<string> {
  const hostList = configuredHosts?.trim() || DEFAULT_PATIENT_PORTAL_HOST;
  const hosts = hostList
    .split(",")
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);

  return new Set(hosts);
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

export function isPatientPortalLocation({
  hostname,
  pathname,
  configuredHosts = import.meta.env.VITE_PATIENT_PORTAL_HOSTS,
}: {
  hostname: string;
  pathname: string;
  configuredHosts?: string;
}): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

  if (normalizedPatientHosts(configuredHosts).has(normalizedHostname)) {
    return true;
  }

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";

  return (
    isLocalDevelopmentHost(normalizedHostname) &&
    (normalizedPath === "/patient-portal" ||
      normalizedPath.startsWith("/patient-portal/"))
  );
}
