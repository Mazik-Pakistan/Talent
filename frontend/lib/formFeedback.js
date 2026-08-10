/**
 * Shared form-feedback primitives for a consistent validation UX across the app.
 *
 * Conventions (match the IT-request forms, which are the reference pattern):
 * - Invalid field → red border on the input (`INPUT_ERROR_STYLE`).
 * - Error text appears directly below the field (`FieldError` component).
 * - General/operation failures → Toastify (`toast.error`), never duplicated
 *   next to a field error.
 * - Success feedback → Toastify (`toast.success`) only after backend confirms.
 */

export const ERROR_COLOR = "#dc2626";

export const INPUT_ERROR_STYLE = { borderColor: ERROR_COLOR };

export const FIELD_ERROR_STYLE = {
  display: "block",
  marginTop: 4,
  fontSize: 12,
  fontWeight: 600,
  color: ERROR_COLOR,
  lineHeight: 1.4,
};

/**
 * Renders the standard inline field error. Place directly below the invalid
 * input/select/textarea.
 */
export default function FieldError({ children, id }) {
  if (!children) return null;
  return (
    <small id={id} style={FIELD_ERROR_STYLE} role="alert">
      {children}
    </small>
  );
}
