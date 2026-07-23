/**
 * Terms & Disclaimers — the target of the first-visit gate's link. Plain statements, not
 * legalese theater. NOTE: pending real legal review (see TODOS, Phase 5 legal gate); this
 * page states the honest position until then.
 */
export default function Terms() {
  return (
    <div className="rise mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight md:text-3xl">Terms &amp; Disclaimers</h1>

      <div className="flex flex-col gap-5 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Unaudited software</h2>
          <p>
            finchpad's smart contracts and website are open-source and have <strong>not</strong> been independently
            audited. Bugs may exist. Liquidity for tokens launched here is permanently locked by design, but no design
            survives every bug. Do not deposit more than you can afford to lose entirely.
          </p>
        </section>

        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Third-party tokens</h2>
          <p>
            Anyone can launch a token through finchpad. Tokens, their names, images and descriptions are created by
            third parties. We do not vet, audit, endorse, or take responsibility for any token, including tokens
            displaying a "boosted" or "featured" badge — those are paid placements, not endorsements.
          </p>
        </section>

        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">No financial advice</h2>
          <p>
            Nothing on this site is investment, legal, or tax advice. Crypto assets are extremely volatile and most
            launched tokens go to zero. Numbers shown (prices, market caps, liquidity, graduation) are best-effort
            reads of on-chain state and can lag or be wrong.
          </p>
        </section>

        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Your wallet, your responsibility</h2>
          <p>
            You are solely responsible for the security of your wallet, keys, and second factors. Transactions on
            finchpad are irreversible once confirmed on-chain. Enable two-factor authentication in Manage account and
            never share your export phrase.
          </p>
        </section>

        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Use at your own risk</h2>
          <p>
            The site and contracts are provided "as is", without warranty of any kind. By using finchpad you accept
            all risk of loss. If your jurisdiction does not permit the use of services like this one, do not use it.
          </p>
        </section>
      </div>
    </div>
  );
}
