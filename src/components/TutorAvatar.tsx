/** A tutor's round photo, or their initials on their calendar color when there's no photo. */
export default function TutorAvatar({
  name,
  photo,
  color,
  size = 64,
}: {
  name: string;
  photo: string | null;
  color: string;
  size?: number;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";

  if (photo) {
    // A data URL stored on the tutor record; next/image adds nothing for these.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt={name} className="tutor-avatar" width={size} height={size} />;
  }
  return (
    <span
      className="tutor-avatar tutor-avatar-initials"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      aria-label={name}
      role="img"
    >
      {initials}
    </span>
  );
}
