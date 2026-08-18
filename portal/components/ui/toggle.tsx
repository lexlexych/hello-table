"use client";

/**
 * Тумблер поверх настоящего `input[type=checkbox]`: клавиатура, `:checked` и
 * скринридеры работают сами, CSS рисует дорожку и кружок.
 */
export function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="switch-track" />
      <span className="switch-label">{label}</span>
    </label>
  );
}
