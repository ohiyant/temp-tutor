"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TimeZoneSelect from "@/components/TimeZoneSelect";
import TutorAvatar from "@/components/TutorAvatar";
import { resizeToSquareJpeg } from "@/lib/resizeImage";

const BIO_MAX = 500;

interface Subject {
  id: string;
  name: string;
}

export default function ProfileManager({
  tutorId,
  isAdmin,
  initialName,
  initialEmail,
  allSubjects,
  initialSubjectIds,
  initialPhone,
  hourlyRateCents,
  initialOnlineAvailable,
  initialInPersonAvailable,
  initialTimeZone,
  initialPhoto,
  initialSchool,
  initialBio,
  initialInPersonLocation,
  initialMeetingLink,
  color,
}: {
  tutorId: string;
  /** Admins can also change the tutor's name and sign-in email. */
  isAdmin: boolean;
  initialName: string;
  initialEmail: string;
  allSubjects: Subject[];
  initialSubjectIds: string[];
  initialPhone: string;
  /** The site-wide rate (set by an admin), shown read-only. */
  hourlyRateCents: number;
  initialOnlineAvailable: boolean;
  initialInPersonAvailable: boolean;
  initialTimeZone: string;
  initialPhoto: string | null;
  initialSchool: string;
  initialBio: string;
  initialInPersonLocation: string;
  initialMeetingLink: string;
  /** The tutor's calendar color, for the placeholder avatar. */
  color: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [subjectIds, setSubjectIds] = useState(new Set(initialSubjectIds));
  const [phone, setPhone] = useState(initialPhone);
  const [online, setOnline] = useState(initialOnlineAvailable);
  const [inPerson, setInPerson] = useState(initialInPersonAvailable);
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [photo, setPhoto] = useState<string | null>(initialPhoto);
  const [school, setSchool] = useState(initialSchool);
  const [bio, setBio] = useState(initialBio);
  const [inPersonLocation, setInPersonLocation] = useState(initialInPersonLocation);
  const [meetingLink, setMeetingLink] = useState(initialMeetingLink);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function pickPhoto(file: File | undefined) {
    setPhotoError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Choose an image file (JPEG, PNG, …).");
      return;
    }
    try {
      setPhoto(await resizeToSquareJpeg(file));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Couldn't read that image.");
    }
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function toggleSubject(id: string) {
    setSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setError(null);

    if (!online && !inPerson) {
      setError("Select at least one of Online or In-person.");
      return;
    }
    if (isAdmin && (!name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim()))) {
      setError("Enter a name and a valid email.");
      return;
    }
    if (subjectIds.size === 0) {
      setError("Select at least one subject.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/tutors/${tutorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isAdmin ? { name: name.trim(), email: email.trim() } : {}),
          phone: phone || null,
          photo,
          school: school.trim() || null,
          bio: bio.trim() || null,
          inPersonLocation: inPersonLocation.trim() || null,
          meetingLink: meetingLink.trim() || null,
          timeZone,
          onlineAvailable: online,
          inPersonAvailable: inPerson,
          subjectIds: Array.from(subjectIds),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      setSavedAt(Date.now());
      router.refresh(); // pick up a new name/email in the page heading
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel-page">
      <div className="panel-grid">
        <section className="card panel profile-public">
          <h2>Public profile</h2>
          <p className="muted small">Shown to students on the welcome page.</p>
          <div className="profile-photo-row">
            <TutorAvatar name={name} photo={photo} color={color} size={72} />
            <div className="profile-photo-actions">
              <label className="btn btn-secondary btn-small">
                {photo ? "Change photo" : "Upload photo"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    pickPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {photo && (
                <button type="button" className="link-button" onClick={() => setPhoto(null)}>
                  Remove
                </button>
              )}
            </div>
          </div>
          {photoError && <p className="error-text">{photoError}</p>}
          <div className="form-field" style={{ margin: "0.8rem 0 0.6rem" }}>
            <label htmlFor="tutor-school">School</label>
            <input
              id="tutor-school"
              value={school}
              maxLength={100}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="e.g. UC Riverside, Computer Science"
            />
          </div>
          <div className="form-field">
            <label htmlFor="tutor-bio">
              About you ({bio.length}/{BIO_MAX})
            </label>
            <textarea
              id="tutor-bio"
              rows={4}
              maxLength={BIO_MAX}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A sentence or two about how you teach and what you like helping with."
              className="profile-bio"
            />
          </div>
        </section>

        <section className="card panel">
          <h2>Sessions</h2>
          <p className="muted small" style={{ marginTop: 0, marginBottom: "0.9rem" }}>
            Rate: ${(hourlyRateCents / 100).toFixed(2)}/hr, the same for every tutor{isAdmin ? " (change it on Admin → Rate)" : ""}.
          </p>
          <div className="form-field">
            <label>Session types</label>
            <label className="checkbox-row">
              <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} /> Online
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={inPerson} onChange={(e) => setInPerson(e.target.checked)} /> In-person
            </label>
          </div>
          {online && (
            <div className="form-field" style={{ marginTop: "0.8rem" }}>
              <label htmlFor="tutor-meeting-link">Online meeting link</label>
              <input
                id="tutor-meeting-link"
                type="url"
                value={meetingLink}
                maxLength={500}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://zoom.us/j/… or https://meet.google.com/…"
              />
              <span className="muted small">
                Sent only to students who book an online session with you. Use a link that stays the same, like
                your Zoom personal meeting room.
              </span>
            </div>
          )}
          {inPerson && (
            <div className="form-field" style={{ marginTop: "0.8rem" }}>
              <label htmlFor="tutor-location">Usual meeting spot</label>
              <input
                id="tutor-location"
                value={inPersonLocation}
                maxLength={200}
                onChange={(e) => setInPersonLocation(e.target.value)}
                placeholder="e.g. Rivera Library, 2nd floor study rooms"
              />
              <span className="muted small">Filled in as a suggestion when students book in person. They can pick somewhere else.</span>
            </div>
          )}
        </section>

        <section className="card panel">
          <h2>Subjects</h2>
          <p className="muted small">Students see you when they pick one of these.</p>
          <div className="subject-chips">
            {allSubjects.map((s) => (
              <label key={s.id} className={`subject-chip${subjectIds.has(s.id) ? " is-on" : ""}`}>
                <input type="checkbox" checked={subjectIds.has(s.id)} onChange={() => toggleSubject(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </section>

        <section className="card panel">
          <h2>Contact & timezone</h2>
          {isAdmin && (
            <>
              <div className="form-field" style={{ marginBottom: "0.6rem" }}>
                <label htmlFor="tutor-name">Name</label>
                <input id="tutor-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-field" style={{ marginBottom: "0.6rem" }}>
                <label htmlFor="tutor-email">Sign-in email</label>
                <input id="tutor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </>
          )}
          <div className="form-field" style={{ marginBottom: "0.6rem" }}>
            <label htmlFor="tutor-phone">Phone</label>
            <input
              id="tutor-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="555-0100"
            />
          </div>
          <div className="form-field">
            <label htmlFor="tutor-tz">Timezone</label>
            <TimeZoneSelect id="tutor-tz" value={timeZone} onChange={setTimeZone} />
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Your hours are in this timezone. Changing it keeps the same clock times (still 4pm–8pm) in the new zone;
            existing bookings keep their exact time.
          </p>
        </section>
      </div>

      <div className="panel-save">
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        {error && <span className="error-text">{error}</span>}
        {savedAt && !error && <span className="success-text">Saved.</span>}
      </div>
    </div>
  );
}
