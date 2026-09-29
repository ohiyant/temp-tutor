"use client";

import { useEffect, useState } from "react";
import { COMMON_TIME_ZONES, allTimeZones, timeZoneOptionLabel } from "@/lib/timezone";

/**
 * Timezone picker: the common US zones first ("Central Time (CDT)"), then
 * every other zone the browser knows. Labels and the full list are only
 * filled in after mounting, because the server's timezone data can differ
 * from the browser's and would otherwise break hydration.
 */
export default function TimeZoneSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (timeZone: string) => void;
  disabled?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <select id={id} value={value} disabled style={{ maxWidth: "17rem" }} onChange={() => {}}>
        <option value={value}>{value.replace(/_/g, " ")}</option>
      </select>
    );
  }

  const common = COMMON_TIME_ZONES.map((z) => z.zone);
  const others = allTimeZones()
    .filter((z) => !common.includes(z))
    .map((z) => ({ zone: z, label: timeZoneOptionLabel(z) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // Keep a saved zone selectable even if this browser doesn't list it.
  if (!common.includes(value) && !others.some((o) => o.zone === value)) {
    others.unshift({ zone: value, label: timeZoneOptionLabel(value) });
  }

  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ maxWidth: "17rem" }}
    >
      <optgroup label="United States">
        {common.map((z) => (
          <option key={z} value={z}>
            {timeZoneOptionLabel(z)}
          </option>
        ))}
      </optgroup>
      <optgroup label="All timezones">
        {others.map((o) => (
          <option key={o.zone} value={o.zone}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
