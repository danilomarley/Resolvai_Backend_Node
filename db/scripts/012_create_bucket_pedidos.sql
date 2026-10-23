-- 012_create_bucket_pedidos.sql
-- Bucket público das fotos dos pedidos (#67). Executar uma vez no SQL Editor do Supabase.
-- O envio é feito só pela API (POST /api/v1/orders/photos), com a service key, que ignora RLS;
-- por isso não há política de escrita para usuários. A leitura é pública porque as URLs são
-- exibidas direto no front (fotos_pedido.foto).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pedidos', 'pedidos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
