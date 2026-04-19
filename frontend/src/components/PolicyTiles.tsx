import { FileText, Mail, Shield } from "lucide-react";

type Props = {
  variant?: "inline" | "floating";
  className?: string;
};

export function PolicyTiles({ variant = "inline", className }: Props) {
  return (
    <div className={`policy-tiles policy-tiles--${variant}${className ? ` ${className}` : ""}`}>
      <a
        className="policy-tiles__tile"
        href="/documents/Terms_and_Conditions.pdf"
        target="_blank"
        rel="noreferrer"
        aria-label="Terms and Conditions"
        title="Terms and Conditions"
      >
        <FileText className="policy-tiles__icon" size={18} aria-hidden />
        <span className="policy-tiles__label">Terms</span>
      </a>
      <a
        className="policy-tiles__tile"
        href="/documents/Privacy_Policy.pdf"
        target="_blank"
        rel="noreferrer"
        aria-label="Privacy Policy"
        title="Privacy Policy"
      >
        <Shield className="policy-tiles__icon" size={18} aria-hidden />
        <span className="policy-tiles__label">Privacy</span>
      </a>
      <a
        className="policy-tiles__tile"
        href="mailto:support@example.com"
        aria-label="Contact"
        title="Contact"
      >
        <Mail className="policy-tiles__icon" size={18} aria-hidden />
        <span className="policy-tiles__label">Contact</span>
      </a>
    </div>
  );
}

