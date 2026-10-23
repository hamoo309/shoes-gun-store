-- Existing product images remain general images (NULL color).
ALTER TABLE "ProductImage" ADD COLUMN "color" TEXT;
CREATE INDEX "ProductImage_productId_color_position_idx" ON "ProductImage"("productId", "color", "position");
