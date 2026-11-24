import type { DiscountTerm, EstimateItem, PriceListItem, Product } from '../lib/types';
import { discountFor, money } from '../lib/totals';
import { priceFor } from '../lib/estimateHelpers';

export function LineItems({ items, products, discountTerms, priceListId, priceListItems, locked, onUpdate, onAdd, onRemove, totals }: {
  items: EstimateItem[]; products: Product[]; discountTerms: DiscountTerm[]; priceListId: string | null; priceListItems: PriceListItem[];
  locked: boolean; onUpdate: (id: string, p: Partial<EstimateItem>) => void; onAdd: () => void; onRemove: (id: string) => void;
  totals: { tax: number; total: number };
}) {
  const active = products.filter((p) => p.active);
  const pickProduct = (item: EstimateItem, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return onUpdate(item.id, { product_id: null, product_code: null });
    const unit_price = priceFor(p, priceListId, priceListItems);
    const term = discountTerms.find((d) => d.id === item.discount_term_id);
    onUpdate(item.id, {
      product_id: p.id, product_code: p.code, product_type: p.product_type, description: p.description, unit_cost: Number(p.unit_cost),
      unit_price, taxable: p.taxable, price_overridden: false, discount_amount: discountFor(term, Number(item.quantity), unit_price),
    });
  };
  const setQty = (item: EstimateItem, q: string) => {
    const quantity = Number(q) || 0;
    const term = discountTerms.find((d) => d.id === item.discount_term_id);
    onUpdate(item.id, { quantity, ...(term ? { discount_amount: discountFor(term, quantity, Number(item.unit_price)) } : {}) });
  };
  const setTerm = (item: EstimateItem, termId: string) => {
    const term = discountTerms.find((d) => d.id === termId);
    onUpdate(item.id, { discount_term_id: termId || null, discount_amount: discountFor(term, Number(item.quantity), Number(item.unit_price)) });
  };
  const num = 'input px-1 text-right tabular-nums';

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="tbl min-w-[860px]">
          <thead>
            <tr>
              <th className="w-[230px]">Product code</th><th>Description</th><th className="w-16 text-right">Qty</th>
              <th className="w-24 text-right">Unit Cost</th><th className="w-24 text-right">Unit Price</th>
              <th className="w-36">Discount Terms</th><th className="w-24 text-right">Discount Amt</th>
              <th className="w-24 text-right">Total Price</th><th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  <select className="input" disabled={locked} value={i.product_id ?? ''} onChange={(e) => pickProduct(i, e.target.value)} aria-label="Product">
                    <option value="">— choose product —</option>
                    {active.map((p) => <option key={p.id} value={p.id}>{p.code} {p.description}</option>)}
                    {i.product_id && !active.some((p) => p.id === i.product_id) && <option value={i.product_id}>{i.product_code} (inactive)</option>}
                  </select>
                </td>
                <td><input className="input" disabled={locked} value={i.description} onChange={(e) => onUpdate(i.id, { description: e.target.value })} aria-label="Description" /></td>
                <td><input className={num} disabled={locked} inputMode="decimal" value={i.quantity} onChange={(e) => setQty(i, e.target.value)} aria-label="Quantity" /></td>
                <td><input className={num} disabled={locked} inputMode="decimal" value={i.unit_cost} onChange={(e) => onUpdate(i.id, { unit_cost: Number(e.target.value) || 0 })} aria-label="Unit cost" /></td>
                <td>
                  <input className={`${num} ${i.price_overridden ? 'bg-amber-50' : ''}`} disabled={locked} inputMode="decimal" value={i.unit_price}
                    title={i.price_overridden ? 'Price overridden on this estimate' : ''}
                    onChange={(e) => onUpdate(i.id, { unit_price: Number(e.target.value) || 0, price_overridden: true })} aria-label="Unit price" />
                </td>
                <td>
                  <select className="input" disabled={locked} value={i.discount_term_id ?? ''} onChange={(e) => setTerm(i, e.target.value)} aria-label="Discount terms">
                    <option value="">None</option>
                    {discountTerms.filter((d) => d.active || d.id === i.discount_term_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td><input className={num} disabled={locked} inputMode="decimal" value={i.discount_amount} onChange={(e) => onUpdate(i.id, { discount_amount: Number(e.target.value) || 0 })} aria-label="Discount amount" /></td>
                <td className="text-right font-semibold tabular-nums">{money(i.total_price)}</td>
                <td>{!locked && <button className="btn-ghost h-8 min-h-0 px-2 text-brandred" onClick={() => onRemove(i.id)} aria-label="Delete line">Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        {!locked ? <button className="btn-ghost" onClick={onAdd}>+ More Lines</button> : <span />}
        <div className="min-w-[220px] text-sm">
          <div className="flex justify-between py-0.5"><span className="text-slate-600">Sales Tax</span><span className="tabular-nums">{money(totals.tax)}</span></div>
          <div className="flex justify-between border-t border-slate-300 py-1 text-xl font-extrabold text-cobalt"><span>TOTAL</span><span className="tabular-nums">{money(totals.total)}</span></div>
        </div>
      </div>
    </div>
  );
}
