import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "OrderCheck — a little certainty in every delivery",
  description:
    "Accessible, evidence-aware delivery verification. Import an order, scan a label, and hear what matches.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
