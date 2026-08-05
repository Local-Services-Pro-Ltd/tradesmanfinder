/**
 * /pro/:slug — public tradesman profile with claim_status-aware rendering
 * (issue #139).
 *
 * Response comes from /api/pro/:slug (server enforces data-minimisation
 * for unclaimed rows; see server/pro-profile.ts). This page's job is
 * ONLY to render the response — it does not decide what to hide, the
 * server has already stripped fields for unclaimed listings.
 *
 * Owner-flow buttons appear when the visitor arrives with
 * ?claim_token=... or ?owner=1 in the URL. Token verification is deferred
 * to /claim/:token (issue #140) — this page just surfaces the CTA.
 */

import { useRoute, Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { MapPin, ShieldCheck, Award } from "lucide-react";
import { useEffect } from "react";

export interface ProProfileResponse {
  slug: string;
  claimStatus: "unclaimed" | "pending" | "claimed";
  businessName: string;
  primaryCategory: string | null;
  townLabel: string | null;
  postcodeDistrict: string | null;
  incorporationYear: number | null;
  isFoundingPro: boolean;
  claimedProfile: {
    bio: string | null;
    heroImageUrl: string | null;
    gallery: string[];
    videoUrl: string | null;
    yearsExperience: number;
    verified: boolean;
    insured: boolean;
    licensed: boolean;
    gasSafeVerified: boolean;
    ratingAverage: number;
    ratingCount: number;
    responseTimeMinutes: number;
  } | null;
}

/**
 * Parse the current URL's search string for the owner-flow indicators.
 * Wouter's useLocation returns the pathname only, so we read from
 * window.location directly.
 */
function useOwnerFlowIndicator(): { claimToken: string | null; ownerFlow: boolean } {
  if (typeof window === "undefined") return { claimToken: null, ownerFlow: false };
  const params = new URLSearchParams(window.location.search);
  const claimToken = params.get("claim_token");
  const ownerFlow = params.get("owner") === "1" || Boolean(claimToken);
  return { claimToken, ownerFlow };
}

/**
 * Set the document title + meta description so search engines and social
 * cards get sensible metadata. React Helmet isn't in the dep tree yet;
 * plain effect is fine for the SPA lifecycle here.
 */
function useDocumentMeta(profile: ProProfileResponse | undefined) {
  useEffect(() => {
    if (!profile) return;
    const suffix = profile.townLabel
      ? ` in ${profile.townLabel}`
      : "";
    document.title = `${profile.businessName}${suffix} | TradesmanFinder`;
    let desc = "";
    if (profile.claimStatus === "claimed") {
      desc = `${profile.businessName}${suffix} — verified profile on TradesmanFinder.`;
    } else {
      desc = `${profile.businessName}${suffix} — unclaimed listing. Own this business? Claim your profile.`;
    }
    let tag = document.querySelector<HTMLMetaElement>("meta[name=description]");
    if (!tag) {
      tag = document.createElement("meta");
      tag.name = "description";
      document.head.appendChild(tag);
    }
    tag.content = desc;
  }, [profile]);
}

export default function ProProfile() {
  const [, params] = useRoute("/pro/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug;
  const { claimToken, ownerFlow } = useOwnerFlowIndicator();

  const { data: profile, isLoading, isError } = useQuery<ProProfileResponse>({
    queryKey: ["/api/pro", slug],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pro/${encodeURIComponent(slug!)}`);
      return res.json();
    },
    enabled: !!slug,
    // 404s (opted_out/deleted/missing) are terminal — no retry.
    retry: false,
  });

  useDocumentMeta(profile);

  if (isLoading) {
    return (
      <Layout>
        <div className="mx-auto max-w-3xl px-4 py-20" data-testid="pro-profile-loading">
          <div className="h-48 animate-pulse rounded-xl bg-muted" />
        </div>
      </Layout>
    );
  }

  if (isError || !profile) {
    return (
      <Layout>
        <div className="mx-auto max-w-3xl px-4 py-24 text-center" data-testid="pro-profile-not-found">
          <h1 className="font-display text-xl font-bold">Profile not found</h1>
          <p className="mt-2 text-muted-foreground">
            This listing may have been removed or is no longer available.
          </p>
          <Link href="/categories">
            <Button className="mt-6">Browse trades</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const isUnclaimed = profile.claimStatus === "unclaimed" || profile.claimStatus === "pending";

  const locationLine = [profile.townLabel, profile.postcodeDistrict]
    .filter(Boolean)
    .join(" · ");

  return (
    <Layout>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <Card className="p-6 sm:p-8" data-testid={`pro-profile-${profile.claimStatus}`}>
          {/* Header row */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1
                className="font-display text-2xl font-bold text-foreground sm:text-3xl"
                data-testid="text-business-name"
              >
                {profile.businessName}
              </h1>
              {profile.primaryCategory && (
                <p className="mt-1 text-sm text-muted-foreground" data-testid="text-primary-category">
                  {profile.primaryCategory}
                </p>
              )}
              {locationLine && (
                <p
                  className="mt-2 flex items-center gap-1 text-sm text-muted-foreground"
                  data-testid="text-location"
                >
                  <MapPin className="h-4 w-4" /> {locationLine}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isUnclaimed && (
                <Badge
                  variant="outline"
                  className="border-amber-400 bg-amber-50 text-amber-900"
                  data-testid="badge-unclaimed"
                >
                  Unclaimed listing
                </Badge>
              )}
              {profile.isFoundingPro && (
                <Badge className="bg-navy text-white" data-testid="badge-founding-pro">
                  <Award className="mr-1 h-3 w-3" /> Founding Pro
                </Badge>
              )}
              {profile.claimedProfile?.verified && (
                <Badge className="bg-emerald-600 text-white" data-testid="badge-verified">
                  <ShieldCheck className="mr-1 h-3 w-3" /> Verified
                </Badge>
              )}
            </div>
          </div>

          {profile.incorporationYear !== null && (
            <p className="mt-4 text-sm text-muted-foreground" data-testid="text-incorporation-year">
              Incorporated {profile.incorporationYear}
            </p>
          )}

          {/* Unclaimed body */}
          {isUnclaimed && (
            <div className="mt-6 border-t border-border pt-6">
              <p className="text-sm text-foreground" data-testid="text-unclaimed-explainer">
                This business hasn't claimed their listing yet. Contact details,
                photos and reviews are hidden until the owner verifies the profile.
              </p>

              {ownerFlow ? (
                <div
                  className="mt-6 flex flex-col gap-3 sm:flex-row"
                  data-testid="owner-flow-buttons"
                >
                  <Button
                    className="flex-1"
                    onClick={() => {
                      // /claim/{token} handles verification (issue #140).
                      // Falls back to a plain claim landing if no token.
                      const dest = claimToken
                        ? `/claim/${encodeURIComponent(claimToken)}`
                        : `/claim/start?slug=${encodeURIComponent(profile.slug)}`;
                      navigate(dest);
                    }}
                    data-testid="button-claim"
                  >
                    {profile.claimStatus === "pending"
                      ? "Resume claim"
                      : "This is my business — claim it"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      const dest = claimToken
                        ? `/delete/${encodeURIComponent(claimToken)}`
                        : `/delete/start?slug=${encodeURIComponent(profile.slug)}`;
                      navigate(dest);
                    }}
                    data-testid="button-remove"
                  >
                    Not my business — remove it
                  </Button>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Own this business?{" "}
                  <Link
                    href={`/pro/${encodeURIComponent(profile.slug)}?owner=1`}
                    className="text-primary underline underline-offset-2 hover:no-underline"
                    data-testid="link-owner-flow"
                  >
                    Claim your profile
                  </Link>
                  .
                </p>
              )}
            </div>
          )}

          {/* Claimed body — minimal for now. Feature parity with
              /tradesman/:slug is a follow-up beyond issue #139's scope. */}
          {profile.claimStatus === "claimed" && profile.claimedProfile && (
            <div className="mt-6 border-t border-border pt-6" data-testid="claimed-body">
              {profile.claimedProfile.heroImageUrl && (
                <img
                  src={profile.claimedProfile.heroImageUrl}
                  alt={profile.businessName}
                  className="mb-6 h-56 w-full rounded-lg object-cover"
                />
              )}
              {profile.claimedProfile.bio && (
                <p className="text-sm text-foreground" data-testid="text-bio">
                  {profile.claimedProfile.bio}
                </p>
              )}
              <div className="mt-6 flex flex-wrap gap-2">
                {profile.claimedProfile.insured && (
                  <Badge variant="outline" data-testid="chip-insured">Insured</Badge>
                )}
                {profile.claimedProfile.licensed && (
                  <Badge variant="outline" data-testid="chip-licensed">Licensed</Badge>
                )}
                {profile.claimedProfile.gasSafeVerified && (
                  <Badge variant="outline" data-testid="chip-gas-safe">Gas Safe</Badge>
                )}
              </div>
              <Link href={`/tradesman/${encodeURIComponent(profile.slug)}`}>
                <Button className="mt-6" data-testid="button-full-profile">
                  Get in touch
                </Button>
              </Link>
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
}
