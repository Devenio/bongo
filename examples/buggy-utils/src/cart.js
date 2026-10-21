// A tiny shopping cart. Prices are in dollars.
export class Cart {
  constructor() { this.items = new Map(); }

  add(sku, price, qty = 1) {
    const line = this.items.get(sku) || { price, qty: 0 };
    line.qty += qty;
    this.items.set(sku, line);
  }

  remove(sku) { this.items.delete(sku); }

  total() {
    let sum = 0;
    for (const { price, qty } of this.items.values()) sum += price * qty;
    return sum;
  }
}
