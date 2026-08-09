import { notFound, redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { getAllCategoriesAdmin } from "@/lib/queries/adminCategories";
import {
  getProductByIdAdmin,
  getProductVariantsAdmin,
  getProductImagesAdmin,
} from "@/lib/queries/adminProducts";
import { ProductForm } from "@/components/admin/ProductForm";
import { VariantManager } from "@/components/admin/VariantManager";
import { ImageManager } from "@/components/admin/ImageManager";
import {
  updateProduct,
  createVariant,
  updateVariant,
  deleteVariant,
} from "@/app/admin/(protected)/products/actions";
import {
  uploadProductImage,
  updateImageAltText,
  deleteProductImage,
  setPrimaryImage,
  moveImageUp,
  moveImageDown,
} from "@/app/admin/(protected)/products/imageActions";
import { MAX_IMAGES_PER_PRODUCT } from "@/lib/storage/productImages";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "تعديل منتج",
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditProductPage({ params }: Props) {
  // فحص مباشر قبل أي استعلام — يشمل هذا ثمن الشراء (purchase_price) الذي
  // يجب ألا يظهر إطلاقاً لغير المدير، وLayout الأب لا يمنع تنفيذ هذه
  // الصفحة بمفرده (سلوك موثّق في Next.js App Router).
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }
  if (!isOwnerAdmin(admin)) {
    redirect("/admin/orders");
  }

  const { id } = await params;
  const productId = Number(id);

  if (!Number.isInteger(productId)) {
    notFound();
  }

  const [product, categories, variants, images] = await Promise.all([
    getProductByIdAdmin(productId),
    getAllCategoriesAdmin(),
    getProductVariantsAdmin(productId),
    getProductImagesAdmin(productId),
  ]);

  if (!product) {
    notFound();
  }

  const boundUpdateProduct = updateProduct.bind(null, productId);
  const boundCreateVariant = createVariant.bind(null, productId);
  const variantsWithActions = variants.map((variant) => ({
    variant,
    updateAction: updateVariant.bind(null, variant.id, productId),
    deleteAction: deleteVariant.bind(null, variant.id, productId),
  }));

  const boundUploadImage = uploadProductImage.bind(null, productId);
  const imagesWithActions = images.map((image) => ({
    image,
    updateAltAction: updateImageAltText.bind(null, image.id, productId),
    deleteAction: deleteProductImage.bind(null, image.id, productId),
    setPrimaryAction: setPrimaryImage.bind(null, image.id, productId),
    moveUpAction: moveImageUp.bind(null, image.id, productId),
    moveDownAction: moveImageDown.bind(null, image.id, productId),
  }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold text-neutral-800">تعديل: {product.name_ar}</h1>
        <div className="mt-4">
          <ProductForm
            action={boundUpdateProduct}
            product={product}
            categories={categories}
            mode="edit"
          />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-neutral-800">المتغيرات / المقاسات</h2>
        <div className="mt-4">
          <VariantManager
            variantsWithActions={variantsWithActions}
            createAction={boundCreateVariant}
          />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-neutral-800">الصور (حتى {MAX_IMAGES_PER_PRODUCT})</h2>
        <div className="mt-4">
          <ImageManager
            images={images}
            uploadAction={boundUploadImage}
            imagesWithActions={imagesWithActions}
            maxImages={MAX_IMAGES_PER_PRODUCT}
          />
        </div>
      </div>
    </div>
  );
}
