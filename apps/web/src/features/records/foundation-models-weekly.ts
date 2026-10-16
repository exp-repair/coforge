import type { TemplateOutlineSection } from "./template-outline-sections";

/** The outline a new weekly template starts with. */
export const FOUNDATION_MODELS_WEEKLY_SECTIONS: TemplateOutlineSection[] = [
  { title: "Summary", children: ["Work Summary", "Next Steps"] },
  { title: "Technique", children: ["Technique"] },
  { title: "Achievements", children: ["Achievements"] },
  { title: "Research", children: ["New paper / model / product"] },
];

export const FOUNDATION_MODELS_WEEKLY_TEMPLATE_NAME = "Foundation Models Weekly";
