export type DockItem = {
  href: string;
  label: string;
  icon: "taps" | "new" | "mine";
};

export const DOCK_ITEMS: DockItem[] = [
  { href: "/", label: "Taps", icon: "taps" },
  { href: "/new", label: "New", icon: "new" },
  { href: "/mine", label: "Mine", icon: "mine" },
];
