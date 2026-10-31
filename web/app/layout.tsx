import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ER Predict",
  description: "Bed-demand forecast and discharge return-risk for the emergency room",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
