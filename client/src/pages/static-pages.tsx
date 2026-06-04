import { useState } from "react";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Users, Heart, Sparkles, Mail, Phone, MapPin, CheckCircle2 } from "lucide-react";

function PageShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Layout>
      <div className="border-b border-border bg-navy">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <h1 className="font-display text-2xl font-bold text-white">{title}</h1>
          {subtitle && <p className="mt-2 text-white/70">{subtitle}</p>}
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">{children}</div>
    </Layout>
  );
}

function Prose({ sections }: { sections: { h: string; p: string }[] }) {
  return (
    <div className="space-y-7">
      {sections.map((s, i) => (
        <section key={i}>
          <h2 className="font-display text-lg font-semibold text-foreground">{s.h}</h2>
          <p className="mt-2 leading-relaxed text-muted-foreground">{s.p}</p>
        </section>
      ))}
    </div>
  );
}

export function About() {
  const values = [
    { icon: ShieldCheck, title: "Trust first", body: "Every tradesman is identity-checked and reviewed. Verified, insured and licensed badges mean what they say." },
    { icon: Users, title: "Local at heart", body: "We connect homeowners with skilled pros in their own neighbourhood — supporting local trade businesses." },
    { icon: Heart, title: "Fair for tradesmen", body: "No subscriptions, no lock-ins. Tradesmen pay only for the leads they choose to pursue." },
    { icon: Sparkles, title: "Quality work", body: "Honest reviews, transparent pricing and a no-obligation quote process keep standards high." },
  ];
  return (
    <PageShell title="About TradesmanFinder" subtitle="Helping UK homeowners find trusted local tradesmen since day one.">
      <p className="text-lg leading-relaxed text-muted-foreground">
        TradesmanFinder was built on a simple idea: finding a reliable tradesman shouldn't be a gamble. We bring together
        homeowners who need work done and skilled, vetted professionals who do it properly — all in one trusted marketplace.
      </p>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {values.map((v) => (
          <Card key={v.title} className="p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><v.icon className="h-6 w-6" /></span>
            <h3 className="mt-4 font-display text-lg font-semibold text-foreground">{v.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{v.body}</p>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}

export function Contact() {
  const { toast } = useToast();
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) {
      toast({ title: "Please complete all fields", variant: "destructive" });
      return;
    }
    setSent(true);
    toast({ title: "Message sent", description: "We'll get back to you within one working day." });
  };
  return (
    <PageShell title="Contact us" subtitle="We'd love to hear from you — homeowners and tradesmen alike.">
      <div className="grid gap-8 md:grid-cols-[1fr_320px]">
        <Card className="p-6">
          {sent ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-trust" />
              <h2 className="mt-3 font-display text-lg font-semibold text-foreground">Thanks for getting in touch</h2>
              <p className="mt-1 text-muted-foreground">We'll reply within one working day.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div><Label htmlFor="cn">Name</Label><Input id="cn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-contact-name" /></div>
              <div><Label htmlFor="ce">Email</Label><Input id="ce" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-contact-email" /></div>
              <div><Label htmlFor="cm">Message</Label><Textarea id="cm" rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} data-testid="input-contact-message" /></div>
              <Button type="submit" data-testid="button-send-message">Send message</Button>
            </form>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-5"><div className="flex items-center gap-3"><Mail className="h-5 w-5 text-primary" /><div><p className="text-sm font-medium text-foreground">Email</p><p className="text-sm text-muted-foreground">hello@tradesmanfinder.com</p></div></div></Card>
          <Card className="p-5"><div className="flex items-center gap-3"><Phone className="h-5 w-5 text-primary" /><div><p className="text-sm font-medium text-foreground">Phone</p><p className="text-sm text-muted-foreground">0800 123 4567</p></div></div></Card>
          <Card className="p-5"><div className="flex items-center gap-3"><MapPin className="h-5 w-5 text-primary" /><div><p className="text-sm font-medium text-foreground">Office</p><p className="text-sm text-muted-foreground">London, United Kingdom</p></div></div></Card>
        </div>
      </div>
    </PageShell>
  );
}

export function Terms() {
  return (
    <PageShell title="Terms of Service" subtitle="Last updated: June 2026">
      <Prose sections={[
        { h: "1. Acceptance of terms", p: "By accessing or using TradesmanFinder, you agree to be bound by these terms. If you do not agree, please do not use the platform. These terms apply to both homeowners posting jobs and tradesmen offering services." },
        { h: "2. Our service", p: "TradesmanFinder is a marketplace that connects homeowners with independent tradesmen. We are not a party to any contract formed between a homeowner and a tradesman, and we do not perform the work ourselves." },
        { h: "3. Tradesman responsibilities", p: "Tradesmen are responsible for the accuracy of their profile, holding appropriate insurance and licences, and carrying out work to a professional standard. Verification badges reflect checks at the time of review and do not constitute a guarantee." },
        { h: "4. Lead credits", p: "Tradesmen purchase lead credits to respond to job enquiries. Credits are non-refundable once a lead has been unlocked but do not expire. Pricing is as shown on the For Tradesmen page." },
        { h: "5. Limitation of liability", p: "To the fullest extent permitted by law, TradesmanFinder is not liable for the quality, safety or legality of work carried out by tradesmen found through the platform. Disputes should be resolved directly between the parties." },
        { h: "6. Changes", p: "We may update these terms from time to time. Continued use of the platform after changes constitutes acceptance of the revised terms." },
      ]} />
    </PageShell>
  );
}

export function Privacy() {
  return (
    <PageShell title="Privacy Policy" subtitle="Last updated: June 2026">
      <Prose sections={[
        { h: "1. Information we collect", p: "We collect information you provide when posting a job or creating a tradesman profile — including your name, contact details, postcode and job descriptions. We also collect basic usage data to improve the service." },
        { h: "2. How we use it", p: "We use your information to match homeowners with relevant tradesmen, to operate and improve the platform, and to communicate with you about your account and enquiries." },
        { h: "3. Sharing", p: "When you post a job, your contact details are shared only with the tradesmen matched to that job. We never sell your personal data to third parties." },
        { h: "4. Your rights (UK GDPR)", p: "You have the right to access, correct or delete your personal data, and to object to or restrict its processing. To exercise these rights, contact us at privacy@tradesmanfinder.com." },
        { h: "5. Data security", p: "We apply appropriate technical and organisational measures to protect your data. No method of transmission over the internet is fully secure, but we work hard to safeguard your information." },
        { h: "6. Cookies", p: "We use only essential functionality to operate the site. This demo build does not use tracking cookies or store data in your browser." },
      ]} />
    </PageShell>
  );
}

export function Faq() {
  const faqs = [
    { q: "Is TradesmanFinder free for homeowners?", a: "Yes — posting a job and receiving quotes is completely free. You're never obligated to hire anyone." },
    { q: "How are tradesmen vetted?", a: "We verify identity and check insurance and licence details where applicable. Verified tradesmen display a badge. We also surface genuine customer reviews." },
    { q: "How quickly will I hear back?", a: "Most matched tradesmen respond within a few hours. Each profile shows a typical response time so you know what to expect." },
    { q: "How many quotes will I get?", a: "We match each job with up to three relevant local tradesmen, so you can compare quotes and choose the best fit." },
    { q: "What if I'm not happy with the work?", a: "Always agree the scope and price in writing before work begins. If something goes wrong, contact us and we'll help where we can — and you can leave an honest review." },
    { q: "Can I post more than one job?", a: "Of course. Post as many jobs as you need — there's no limit and no charge for homeowners." },
  ];
  return (
    <PageShell title="Frequently asked questions" subtitle="Everything you need to know about using TradesmanFinder.">
      <Accordion type="single" collapsible>
        {faqs.map((f, i) => (
          <AccordionItem key={i} value={`item-${i}`} data-testid={`faq-${i}`}>
            <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
            <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </PageShell>
  );
}
