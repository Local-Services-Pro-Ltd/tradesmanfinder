import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Category, Area } from "@/lib/api-types";
import { Check, Gift } from "lucide-react";

export default function Join() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });

  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    businessName: "", ownerName: "", email: "", phone: "", postcode: "",
    areaId: "", bio: "", yearsExperience: "", insured: false, licensed: false,
  });
  const [cats, setCats] = useState<number[]>([]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const toggleCat = (id: number) => setCats((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.businessName || !form.ownerName || !form.email || !form.areaId || cats.length === 0) {
      toast({ title: "Please complete the required fields", description: "Business name, your name, email, area and at least one trade are required.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/tradesmen", {
        businessName: form.businessName, ownerName: form.ownerName, email: form.email,
        phone: form.phone || "N/A", postcode: form.postcode, areaId: Number(form.areaId),
        bio: form.bio || `${form.businessName} — a trusted local trade business.`,
        yearsExperience: Number(form.yearsExperience) || 1,
        categories: cats, insured: form.insured, licensed: form.licensed,
        gallery: [], heroImageUrl: "/assets/hero-builder.png",
        ratingAverage: 0, ratingCount: 0, responseTimeMinutes: 60,
      });
      const created = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/tradesmen"] });
      toast({ title: "Welcome to TradesmanFinder!", description: "Your profile is live and we've added 3 free welcome credits." });
      navigate(`/dashboard?id=${created.id}`);
    } catch {
      toast({ title: "Something went wrong", description: "Please check your details and try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="border-b border-border bg-navy">
        <div className="mx-auto max-w-3xl px-4 py-10 text-center">
          <h1 className="font-display text-2xl font-bold text-white">Join TradesmanFinder</h1>
          <p className="mt-2 text-white/70">Create your free profile in under 5 minutes and start receiving local leads.</p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary/20 px-4 py-1.5 text-sm font-medium text-primary">
            <Gift className="h-4 w-4" /> Get 3 free lead credits when you join
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10">
        <form onSubmit={submit}>
          <Card className="space-y-5 p-6 sm:p-8">
            <h2 className="font-display text-lg font-semibold text-foreground">Business details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="bn">Business name *</Label><Input id="bn" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} data-testid="input-business-name" /></div>
              <div><Label htmlFor="on">Your name *</Label><Input id="on" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} data-testid="input-owner-name" /></div>
              <div><Label htmlFor="em">Email *</Label><Input id="em" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="input-email" /></div>
              <div><Label htmlFor="ph">Phone</Label><Input id="ph" value={form.phone} onChange={(e) => set("phone", e.target.value)} data-testid="input-phone" /></div>
              <div>
                <Label>Primary area *</Label>
                <Select value={form.areaId} onValueChange={(v) => set("areaId", v)}>
                  <SelectTrigger data-testid="select-area"><SelectValue placeholder="Choose area" /></SelectTrigger>
                  <SelectContent>{(areas || []).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}, {a.region}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="pc">Postcode</Label><Input id="pc" placeholder="e.g. SE2 9XY" value={form.postcode} onChange={(e) => set("postcode", e.target.value)} data-testid="input-postcode" /></div>
              <div><Label htmlFor="yr">Years of experience</Label><Input id="yr" type="number" min="0" value={form.yearsExperience} onChange={(e) => set("yearsExperience", e.target.value)} data-testid="input-years" /></div>
            </div>

            <div>
              <Label>Trades you offer *</Label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(categories || []).map((c) => (
                  <button
                    key={c.id} type="button" data-testid={`option-trade-${c.slug}`}
                    onClick={() => toggleCat(c.id)}
                    className={`rounded-lg border p-2.5 text-left text-sm transition-colors ${cats.includes(c.id) ? "border-primary bg-primary/5 font-medium text-foreground" : "border-border hover:border-primary/50 text-muted-foreground"}`}
                  >
                    <span className="flex items-center gap-1.5">{cats.includes(c.id) && <Check className="h-3.5 w-3.5 text-primary" />}{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="bio">About your business</Label>
              <Textarea id="bio" rows={4} placeholder="Tell customers what makes you the right choice…" value={form.bio} onChange={(e) => set("bio", e.target.value)} data-testid="input-bio" />
            </div>

            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox checked={form.insured} onCheckedChange={(v) => set("insured", !!v)} data-testid="checkbox-insured" /> I have public liability insurance
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox checked={form.licensed} onCheckedChange={(v) => set("licensed", !!v)} data-testid="checkbox-licensed" /> I hold relevant trade licences
              </label>
            </div>

            <p className="text-xs text-muted-foreground">New profiles are reviewed and verified by our team within 48 hours. By joining you agree to our terms of service.</p>

            <Button type="submit" size="lg" className="w-full" disabled={submitting} data-testid="button-create-profile">
              {submitting ? "Creating your profile…" : "Create my free profile"}
            </Button>
          </Card>
        </form>
      </div>
    </Layout>
  );
}
