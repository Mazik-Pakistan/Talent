"use client";

/**
 * Shared sidebar logo: compact centered TalentAI wordmark when expanded,
 * Mazik grid icon when collapsed.
 */
export default function SidebarBrand({
  collapsed = false,
  className,
  markClassName,
  onClick,
  title,
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      title={title || (collapsed ? "Expand sidebar" : "Collapse sidebar")}
      aria-expanded={!collapsed}
    >
      <div className={markClassName} aria-hidden="true">
        <img
          src={collapsed ? "/mazikglobal-icon.svg" : "/talentai-logo.png"}
          alt="Mazik Global TalentAI"
          style={
            collapsed
              ? {
                  width: 36,
                  height: 36,
                  display: "block",
                  objectFit: "contain",
                  margin: "0 auto",
                }
              : {
                  width: "auto",
                  height: "auto",
                  maxWidth: 148,
                  maxHeight: 52,
                  display: "block",
                  objectFit: "contain",
                  objectPosition: "center center",
                  margin: "0 auto",
                }
          }
        />
      </div>
    </button>
  );
}
