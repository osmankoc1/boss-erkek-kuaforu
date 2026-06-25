import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="flex-1 pt-16">{children}</main>
      <Footer />
    </>
  );
}
