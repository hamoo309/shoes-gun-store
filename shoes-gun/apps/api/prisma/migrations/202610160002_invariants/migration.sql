-- Monetary values are integer piasters; enforce invariants even outside the API.
ALTER TABLE "Product" ADD CONSTRAINT "Product_money_check" CHECK ("price" >= 0 AND ("cost" IS NULL OR "cost" >= 0) AND ("compareAtPrice" IS NULL OR "compareAtPrice" > "price"));
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_stock_check" CHECK ("stock" >= 0 AND "lowStockThreshold" >= 0);
ALTER TABLE "Governorate" ADD CONSTRAINT "Governorate_money_check" CHECK ("shippingFee" >= 0 AND ("shippingCost" IS NULL OR "shippingCost" >= 0));
ALTER TABLE "Order" ADD CONSTRAINT "Order_money_check" CHECK ("subtotal" >= 0 AND "shippingFee" >= 0 AND "paymentFee" >= 0 AND "total" = "subtotal" + "shippingFee" AND "refundedAmount" >= 0 AND "refundedAmount" <= "total");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_check" CHECK ("quantity" > 0 AND "returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity" AND "unitPrice" >= 0 AND "lineTotal" = "unitPrice" * "quantity" AND ("unitCost" IS NULL OR "unitCost" >= 0));
ALTER TABLE "Return" ADD CONSTRAINT "Return_refund_check" CHECK ("refundAmount" >= 0);
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_check" CHECK ("amount" > 0);
