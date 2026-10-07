begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'customer' check (role in ('admin', 'customer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;

create or replace function public.is_biotech_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;
revoke all on function public.is_biotech_admin() from public, anon;
grant execute on function public.is_biotech_admin() to authenticated;

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_biotech_admin()));

create table if not exists public.business_state (
  state_key text primary key check (state_key in (
    'products', 'categories', 'orders', 'expenses', 'currency', 'shipping', 'promos',
    'activityLog', 'storeSettings', 'suppliers', 'supplierPurchases', 'supplierLedger',
    'customerExtras', 'productReviews'
  )),
  value jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.business_state enable row level security;
revoke all on public.business_state from public, anon, authenticated;
grant select on public.business_state to authenticated;
drop policy if exists business_state_admin_read on public.business_state;
create policy business_state_admin_read on public.business_state
  for select to authenticated using ((select public.is_biotech_admin()));

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'business_state'
     ) then
    execute 'alter publication supabase_realtime add table public.business_state';
  end if;
end;
$$;

create or replace function public.save_business_state(
  p_state_key text,
  p_value jsonb,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  next_version bigint;
  expected_kind text;
begin
  if not (select public.is_biotech_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_state_key is null or p_state_key not in (
    'products', 'categories', 'orders', 'expenses', 'currency', 'shipping', 'promos',
    'activityLog', 'storeSettings', 'suppliers', 'supplierPurchases', 'supplierLedger',
    'customerExtras', 'productReviews'
  ) or p_value is null or pg_column_size(p_value) > 10000000 then
    raise exception 'Invalid state payload' using errcode = '22023';
  end if;

  expected_kind := case
    when p_state_key in ('products', 'categories', 'orders', 'expenses', 'promos', 'activityLog', 'suppliers', 'supplierPurchases', 'supplierLedger', 'productReviews') then 'array'
    when p_state_key = 'currency' then 'string'
    else 'object'
  end;
  if jsonb_typeof(p_value) <> expected_kind then
    raise exception 'Invalid JSON type for %', p_state_key using errcode = '22023';
  end if;
  if p_state_key in ('products', 'storeSettings') and p_value::text ~* 'data:image/' then
    raise exception 'Sube las imágenes a Supabase Storage; no se aceptan imágenes base64 en el estado' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_state_key, 0));
  select s.version into current_version
  from public.business_state s
  where s.state_key = p_state_key
  for update;

  if not found then
    if coalesce(p_expected_version, -1) <> 0 then
      raise exception 'State changed on another device; reload before saving' using errcode = '40001';
    end if;
    insert into public.business_state (state_key, value, version, updated_by)
    values (p_state_key, p_value, 1, (select auth.uid()));
    return 1;
  end if;

  if p_expected_version is null or p_expected_version <> current_version then
    raise exception 'State changed on another device; reload before saving' using errcode = '40001';
  end if;
  next_version := current_version + 1;
  update public.business_state
  set value = p_value, version = next_version, updated_by = (select auth.uid()), updated_at = now()
  where state_key = p_state_key;
  return next_version;
end;
$$;
revoke all on function public.save_business_state(text, jsonb, bigint) from public, anon;
grant execute on function public.save_business_state(text, jsonb, bigint) to authenticated;

create or replace function public.save_business_state_batch(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  change jsonb;
  v_state_key text;
  expected_version bigint;
  current_version bigint;
  next_version bigint;
  expected_kind text;
  result jsonb := '[]'::jsonb;
begin
  if not (select public.is_biotech_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) < 1 or jsonb_array_length(p_changes) > 14
     or (select count(distinct entry.value ->> 'key') from jsonb_array_elements(p_changes) as entry(value)) <> jsonb_array_length(p_changes) then
    raise exception 'Invalid state batch' using errcode = '22023';
  end if;

  for change in select entry.value from jsonb_array_elements(p_changes) as entry(value) order by entry.value ->> 'key' loop
    v_state_key := change ->> 'key';
    expected_version := nullif(change ->> 'expectedVersion', '')::bigint;
    if v_state_key is null or v_state_key not in (
      'products', 'categories', 'orders', 'expenses', 'currency', 'shipping', 'promos',
      'activityLog', 'storeSettings', 'suppliers', 'supplierPurchases', 'supplierLedger',
      'customerExtras', 'productReviews'
    ) or change -> 'value' is null or pg_column_size(change -> 'value') > 10000000 then
      raise exception 'Invalid state payload for %', v_state_key using errcode = '22023';
    end if;
    expected_kind := case
      when v_state_key in ('products', 'categories', 'orders', 'expenses', 'promos', 'activityLog', 'suppliers', 'supplierPurchases', 'supplierLedger', 'productReviews') then 'array'
      when v_state_key = 'currency' then 'string'
      else 'object'
    end;
    if jsonb_typeof(change -> 'value') <> expected_kind then
      raise exception 'Invalid JSON type for %', v_state_key using errcode = '22023';
    end if;
    if v_state_key in ('products', 'storeSettings') and (change -> 'value')::text ~* 'data:image/' then
      raise exception 'Sube las imágenes a Supabase Storage; no se aceptan imágenes base64 en el estado' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_state_key, 0));
    select state.version into current_version from public.business_state state where state.state_key = v_state_key for update;
    if not found then
      if coalesce(expected_version, -1) <> 0 then
        raise exception 'State changed on another device; reload before saving' using errcode = '40001';
      end if;
    elsif expected_version is null or expected_version <> current_version then
      raise exception 'State changed on another device; reload before saving' using errcode = '40001';
    end if;
  end loop;

  for change in select entry.value from jsonb_array_elements(p_changes) as entry(value) order by entry.value ->> 'key' loop
    v_state_key := change ->> 'key';
    select state.version into current_version from public.business_state state where state.state_key = v_state_key;
    if not found then
      next_version := 1;
      insert into public.business_state (state_key, value, version, updated_by)
      values (v_state_key, change -> 'value', next_version, (select auth.uid()));
    else
      next_version := current_version + 1;
      update public.business_state
      set value = change -> 'value', version = next_version, updated_by = (select auth.uid()), updated_at = now()
      where public.business_state.state_key = v_state_key;
    end if;
    result := result || jsonb_build_array(jsonb_build_object('key', v_state_key, 'version', next_version));
  end loop;
  return result;
end;
$$;
revoke all on function public.save_business_state_batch(jsonb) from public, anon;
grant execute on function public.save_business_state_batch(jsonb) to authenticated;

create or replace function public.public_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.item -> 'id',
    'name', p.item -> 'name',
    'category', p.item -> 'category',
    'subcategory', p.item -> 'subcategory',
    'description', p.item -> 'description',
    'details', p.item -> 'details',
    'ingredients', p.item -> 'ingredients',
    'usage', p.item -> 'usage',
    'tag', p.item -> 'tag',
    'price', p.item -> 'price',
    'stock', p.item -> 'stock',
    'incoming', p.item -> 'incoming',
    'arrivalDate', p.item -> 'arrivalDate',
    'allowPreorder', p.item -> 'allowPreorder',
    'barcode', p.item -> 'barcode',
    'image', case
      when coalesce(p.item ->> 'image', '') ~* '^https://'
        and coalesce(p.item ->> 'image', '') not like 'biotech-photo:%'
        and coalesce(p.item ->> 'image', '') not like 'data:%'
      then p.item -> 'image'
      else 'null'::jsonb
    end,
    'gallery', case
      when jsonb_typeof(p.item -> 'gallery') = 'array' then coalesce((
        select jsonb_agg(g.value order by g.ordinality)
        from jsonb_array_elements(p.item -> 'gallery') with ordinality as g(value, ordinality)
        where jsonb_typeof(g.value) = 'string' and g.value #>> '{}' ~* '^https://'
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  ) order by p.ordinality), '[]'::jsonb)
  from public.business_state s
  cross join lateral jsonb_array_elements(s.value) with ordinality as p(item, ordinality)
  where s.state_key = 'products'
    and coalesce(p.item ->> 'status', 'published') not in ('draft', 'archived')
    and coalesce((p.item ->> 'published')::boolean, true)
$$;
revoke all on function public.public_catalog() from public;
grant execute on function public.public_catalog() to anon, authenticated;

create or replace function public.public_storefront_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'currency', coalesce((select s.value #>> '{}' from public.business_state s where s.state_key = 'currency'), 'USD'),
    'shipping', jsonb_build_object(
      'fee', coalesce((select s.value -> 'fee' from public.business_state s where s.state_key = 'shipping'), '3'::jsonb),
      'freeFrom', coalesce((select s.value -> 'freeFrom' from public.business_state s where s.state_key = 'shipping'), '60'::jsonb)
    ),
    'storeSettings', jsonb_build_object(
      'name', coalesce((select s.value -> 'name' from public.business_state s where s.state_key = 'storeSettings'), '"BioTech Suplementos"'::jsonb),
      'email', (select s.value -> 'email' from public.business_state s where s.state_key = 'storeSettings'),
      'phone', (select s.value -> 'phone' from public.business_state s where s.state_key = 'storeSettings'),
      'address', (select s.value -> 'address' from public.business_state s where s.state_key = 'storeSettings'),
      'logo', (select s.value -> 'logo' from public.business_state s where s.state_key = 'storeSettings'),
      'bannerTitle', (select s.value -> 'bannerTitle' from public.business_state s where s.state_key = 'storeSettings'),
      'bannerText', (select s.value -> 'bannerText' from public.business_state s where s.state_key = 'storeSettings'),
      'bannerImage', (select s.value -> 'bannerImage' from public.business_state s where s.state_key = 'storeSettings'),
      'bannerVideo', (select s.value -> 'bannerVideo' from public.business_state s where s.state_key = 'storeSettings')
    ),
    'customerExtras', jsonb_build_object(
      'whatsappContacts', coalesce((select s.value -> 'whatsappContacts' from public.business_state s where s.state_key = 'customerExtras'), '[]'::jsonb),
      'copyright', (select s.value -> 'copyright' from public.business_state s where s.state_key = 'customerExtras'),
      'exchangeRate', (select s.value -> 'exchangeRate' from public.business_state s where s.state_key = 'customerExtras'),
      'googleReviewUrl', (select s.value -> 'googleReviewUrl' from public.business_state s where s.state_key = 'customerExtras'),
      'privacyUrl', (select s.value -> 'privacyUrl' from public.business_state s where s.state_key = 'customerExtras'),
      'termsUrl', (select s.value -> 'termsUrl' from public.business_state s where s.state_key = 'customerExtras'),
      'aboutText', (select s.value -> 'aboutText' from public.business_state s where s.state_key = 'customerExtras'),
      'paymentText', (select s.value -> 'paymentText' from public.business_state s where s.state_key = 'customerExtras'),
      'facebookUrl', (select s.value -> 'facebookUrl' from public.business_state s where s.state_key = 'customerExtras'),
      'instagramUrl', (select s.value -> 'instagramUrl' from public.business_state s where s.state_key = 'customerExtras')
    )
  )
$$;
revoke all on function public.public_storefront_settings() from public;
grant execute on function public.public_storefront_settings() to anon, authenticated;

create or replace function public.public_categories()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.value, '[
    {"name":"Proteína","subcategories":["Proteína","Ganadores de masa"]},
    {"name":"Rendimiento","subcategories":["Pre-entreno","Quemagrasas","Creatina","Test boosters","BCAA y EAA"]},
    {"name":"Bienestar","subcategories":["Salud y bienestar","Vitaminas y minerales"]},
    {"name":"Accesorios","subcategories":["Ropa","Alimentos funcionales","Accesorios de entrenamiento"]}
  ]'::jsonb)
  from (select 1) seed
  left join public.business_state s on s.state_key = 'categories'
$$;
revoke all on function public.public_categories() from public;
grant execute on function public.public_categories() to anon, authenticated;

create or replace function public.public_promotions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', p.value -> 'code', 'type', p.value -> 'type', 'value', p.value -> 'value',
    'active', p.value -> 'active', 'expires', p.value -> 'expires'
  )), '[]'::jsonb)
  from public.business_state s
  cross join lateral jsonb_array_elements(s.value) p(value)
  where s.state_key = 'promos'
    and coalesce((p.value ->> 'active')::boolean, false)
    and (nullif(p.value ->> 'expires', '') is null or (p.value ->> 'expires')::date >= current_date)
$$;
revoke all on function public.public_promotions() from public;
grant execute on function public.public_promotions() to anon, authenticated;

create or replace function public.public_product_reviews()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.item -> 'id',
    'productId', r.item -> 'productId',
    'name', r.item -> 'name',
    'text', r.item -> 'text',
    'rating', r.item -> 'rating',
    'date', r.item -> 'date',
    'approved', true
  ) order by r.ordinality desc), '[]'::jsonb)
  from public.business_state s
  cross join lateral jsonb_array_elements(s.value) with ordinality as r(item, ordinality)
  where s.state_key = 'productReviews' and coalesce((r.item ->> 'approved')::boolean, false)
$$;
revoke all on function public.public_product_reviews() from public;
grant execute on function public.public_product_reviews() to anon, authenticated;

create sequence if not exists public.biotech_review_seq;

create or replace function public.submit_public_review(
  p_product_id text,
  p_display_name text,
  p_rating smallint,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_products jsonb;
  v_reviews jsonb;
  v_review jsonb;
begin
  if p_product_id is null or length(p_product_id) > 100
     or p_rating is null or p_rating < 1 or p_rating > 5
     or length(trim(coalesce(p_body, ''))) < 8 or length(p_body) > 600
     or length(trim(coalesce(p_display_name, ''))) > 60 then
    raise exception 'Opinión no válida' using errcode = '22023';
  end if;
  select s.value into v_products from public.business_state s where s.state_key = 'products';
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_products, '[]'::jsonb)) p(value)
    where p.value ->> 'id' = p_product_id
  ) then
    raise exception 'El producto ya no está disponible' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('productReviews', 0));
  select s.value into v_reviews from public.business_state s where s.state_key = 'productReviews' for update;
  if v_reviews is not null and jsonb_typeof(v_reviews) <> 'array' then
    raise exception 'El registro de opiniones no tiene un formato válido' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(v_reviews, '[]'::jsonb)) >= 5000 then
    raise exception 'Por ahora no se pueden recibir más opiniones' using errcode = '54000';
  end if;
  v_review := jsonb_build_object(
    'id', 'rev-' || nextval('public.biotech_review_seq')::text,
    'productId', p_product_id,
    'name', coalesce(nullif(trim(p_display_name), ''), 'Cliente'),
    'text', trim(p_body),
    'rating', p_rating,
    'date', now(),
    'approved', false
  );
  insert into public.business_state (state_key, value, version, updated_by)
  values ('productReviews', coalesce(v_reviews, '[]'::jsonb) || jsonb_build_array(v_review), 1, null)
  on conflict (state_key) do update
    set value = excluded.value, version = public.business_state.version + 1,
        updated_at = now(), updated_by = null;
end;
$$;
revoke all on function public.submit_public_review(text, text, smallint, text) from public;
grant execute on function public.submit_public_review(text, text, smallint, text) to anon, authenticated;

create sequence if not exists public.biotech_order_number_seq;

create or replace function public.create_public_order(
  p_customer jsonb,
  p_items jsonb,
  p_promo_code text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_products jsonb;
  v_orders jsonb;
  v_updated_orders jsonb;
  v_shipping_settings jsonb;
  v_promos jsonb;
  v_items jsonb := '[]'::jsonb;
  v_request jsonb;
  v_product jsonb;
  v_item jsonb;
  v_index integer;
  v_qty integer;
  v_stock integer;
  v_incoming integer;
  v_preorder integer;
  v_allow_preorder boolean;
  v_price numeric(14,2);
  v_cost numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_shipping_amount numeric(14,2) := 0;
  v_total numeric(14,2);
  v_fee numeric(14,2);
  v_free_from numeric(14,2);
  v_promo jsonb;
  v_code text := upper(trim(coalesce(p_promo_code, '')));
  v_order_id text;
  v_existing_order jsonb;
  v_phone_digits text;
  v_recent_orders integer;
  v_currency text;
  v_name text := trim(coalesce(p_customer ->> 'name', ''));
  v_phone text := trim(coalesce(p_customer ->> 'phone', ''));
  v_address text := trim(coalesce(p_customer ->> 'address', ''));
  v_payment text := trim(coalesce(p_customer ->> 'payment', ''));
  v_delivery text := nullif(trim(coalesce(p_customer ->> 'deliveryDate', '')), '');
  v_marketing_opt_in boolean := coalesce(p_customer ->> 'marketingOptIn', 'false') = 'true';
  v_order jsonb;
begin
  if p_customer is null or jsonb_typeof(p_customer) <> 'object'
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30
     or p_request_id is null then
    raise exception 'Datos del pedido inválidos' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 120
     or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 8
     or length(v_phone) > 40 or length(v_address) < 2 or length(v_address) > 300
     or v_payment not in ('Coordinar por WhatsApp', 'Transferencia', 'Efectivo contra entrega') then
    raise exception 'Revisa los datos de entrega y pago' using errcode = '22023';
  end if;
  v_phone_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  if v_delivery is not null and v_delivery::date < current_date then
    raise exception 'La fecha solicitada ya pasó' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(727443091);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('orders', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('products', 0));
  select s.value into v_products from public.business_state s where s.state_key = 'products' for update;
  if v_products is null or jsonb_array_length(v_products) = 0 then
    raise exception 'El catálogo todavía no está disponible' using errcode = 'P0001';
  end if;
  select coalesce(s.value, '[]'::jsonb) into v_orders from public.business_state s where s.state_key = 'orders' for update;
  select coalesce((select s.value from public.business_state s where s.state_key = 'shipping'), '{"fee":3,"freeFrom":60}'::jsonb) into v_shipping_settings;
  select coalesce(s.value, '[]'::jsonb) into v_promos from public.business_state s where s.state_key = 'promos';
  select coalesce((select s.value #>> '{}' from public.business_state s where s.state_key = 'currency'), 'USD') into v_currency;

  select order_row.value into v_existing_order
  from jsonb_array_elements(coalesce(v_orders, '[]'::jsonb)) as order_row(value)
  where order_row.value ->> 'requestId' = p_request_id::text
  limit 1;
  if v_existing_order is not null then
    return jsonb_build_object(
      'id', v_existing_order -> 'id', 'subtotal', v_existing_order -> 'subtotal',
      'shipping', v_existing_order -> 'shipping', 'discount', v_existing_order -> 'discount',
      'promoCode', v_existing_order -> 'promoCode', 'total', v_existing_order -> 'total',
      'currency', v_existing_order -> 'currency'
    );
  end if;
  select count(*)::integer into v_recent_orders
  from jsonb_array_elements(coalesce(v_orders, '[]'::jsonb)) as order_row(value)
  where regexp_replace(coalesce(order_row.value ->> 'phone', ''), '[^0-9]', '', 'g') = v_phone_digits
    and nullif(order_row.value ->> 'date', '')::timestamptz >= now() - interval '24 hours';
  if v_recent_orders >= 5 then
    raise exception 'Se alcanzó el límite temporal de pedidos para este número' using errcode = 'P0001';
  end if;

  for v_request in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_request ->> 'id', '') = '' then
      raise exception 'Producto inválido en el pedido' using errcode = '22023';
    end if;
    v_qty := nullif(v_request ->> 'qty', '')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'Cantidad inválida' using errcode = '22023';
    end if;
    select (p.ordinality - 1)::integer into v_index
    from jsonb_array_elements(v_products) with ordinality as p(value, ordinality)
    where p.value ->> 'id' = v_request ->> 'id'
      and coalesce(p.value ->> 'status', 'published') not in ('draft', 'archived')
    limit 1;
    if v_index is null then
      raise exception 'Uno de los productos ya no está disponible' using errcode = 'P0001';
    end if;
    v_product := v_products -> v_index;
    v_stock := greatest(0, coalesce(nullif(v_product ->> 'stock', '')::integer, 0));
    v_incoming := greatest(0, coalesce(nullif(v_product ->> 'incoming', '')::integer, 0));
    v_preorder := greatest(0, v_qty - v_stock);
    v_allow_preorder := coalesce(nullif(v_product ->> 'allowPreorder', '')::boolean, true);
    if v_qty > v_stock + v_incoming or (v_preorder > 0 and (not v_allow_preorder or v_incoming < v_preorder)) then
      raise exception 'La disponibilidad de % cambió', coalesce(v_product ->> 'name', 'un producto') using errcode = 'P0001';
    end if;
    v_price := round(coalesce(nullif(v_product ->> 'price', '')::numeric, -1), 2);
    v_cost := round(coalesce(nullif(v_product ->> 'cost', '')::numeric, 0), 2);
    if v_price < 0 or v_price > 10000000 or v_cost < 0 then
      raise exception 'Precio no válido en el catálogo' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + v_price * v_qty;
    v_item := jsonb_build_object(
      'id', v_product -> 'id', 'name', v_product -> 'name', 'qty', v_qty,
      'preorder', v_preorder > 0, 'preorderQty', v_preorder,
      'price', v_price, 'cost', v_cost, 'arrivalDate', coalesce(v_product -> 'arrivalDate', '""'::jsonb)
    );
    v_items := v_items || jsonb_build_array(v_item);
    v_product := jsonb_set(v_product, '{stock}', to_jsonb(greatest(0, v_stock - v_qty)), true);
    v_product := jsonb_set(v_product, '{incoming}', to_jsonb(greatest(0, v_incoming - v_preorder)), true);
    v_products := jsonb_set(v_products, array[v_index::text], v_product, false);
  end loop;

  if v_code <> '' then
    select p.value into v_promo from jsonb_array_elements(v_promos) as p(value)
    where upper(coalesce(p.value ->> 'code', '')) = v_code
    limit 1;
    if v_promo is null or not coalesce((v_promo ->> 'active')::boolean, false)
       or (nullif(v_promo ->> 'expires', '') is not null and (v_promo ->> 'expires')::date < current_date) then
      raise exception 'El código promocional no es válido o está vencido' using errcode = 'P0001';
    end if;
    if v_promo ->> 'type' = 'percent' then
      v_discount := round(least(v_subtotal, v_subtotal * greatest(0, least(100, coalesce((v_promo ->> 'value')::numeric, 0))) / 100), 2);
    elsif v_promo ->> 'type' in ('fixed', 'amount') then
      v_discount := least(v_subtotal, greatest(0, coalesce((v_promo ->> 'value')::numeric, 0)));
    end if;
  end if;
  v_fee := greatest(0, coalesce(nullif(v_shipping_settings ->> 'fee', '')::numeric, 3));
  v_free_from := greatest(0, coalesce(nullif(v_shipping_settings ->> 'freeFrom', '')::numeric, 60));
  if v_subtotal - v_discount < v_free_from then v_shipping_amount := v_fee; end if;
  v_total := round(v_subtotal - v_discount + v_shipping_amount, 2);
  v_order_id := 'BT-' || lpad(nextval('public.biotech_order_number_seq')::text, 7, '0');
  v_order := jsonb_build_object(
    'id', v_order_id, 'requestId', p_request_id::text, 'date', now(), 'name', v_name, 'phone', v_phone, 'address', v_address,
    'deliveryDate', coalesce(v_delivery, ''), 'payment', v_payment, 'items', v_items,
    'marketingOptIn', v_marketing_opt_in,
    'subtotal', v_subtotal, 'shipping', v_shipping_amount, 'discount', v_discount,
    'promoCode', v_code, 'total', v_total, 'currency', v_currency, 'status', 'Pendiente'
  );
  v_updated_orders := coalesce(v_orders, '[]'::jsonb) || jsonb_build_array(v_order);
  if pg_column_size(v_products) > 10000000 or pg_column_size(v_updated_orders) > 10000000 then
    raise exception 'El registro alcanzó su límite de tamaño; contacta a administración' using errcode = '54000';
  end if;

  update public.business_state
  set value = v_products, version = version + 1, updated_at = now(), updated_by = null
  where state_key = 'products';
  if found then
    insert into public.business_state (state_key, value, version, updated_by)
    values ('orders', v_updated_orders, 1, null)
    on conflict (state_key) do update
      set value = excluded.value,
          version = public.business_state.version + 1, updated_at = now(), updated_by = null;
  end if;
  return jsonb_build_object(
    'id', v_order_id, 'subtotal', v_subtotal, 'shipping', v_shipping_amount,
    'discount', v_discount, 'promoCode', v_code, 'total', v_total, 'currency', v_currency
  );
end;
$$;
revoke all on function public.create_public_order(jsonb, jsonb, text, uuid) from public;
grant execute on function public.create_public_order(jsonb, jsonb, text, uuid) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 8388608, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;

insert into public.business_state (state_key, value, version)
values ('categories', '[
  {"name":"Proteína","subcategories":["Proteína","Ganadores de masa"]},
  {"name":"Rendimiento","subcategories":["Pre-entreno","Quemagrasas","Creatina","Test boosters","BCAA y EAA"]},
  {"name":"Bienestar","subcategories":["Salud y bienestar","Vitaminas y minerales"]},
  {"name":"Accesorios","subcategories":["Ropa","Alimentos funcionales","Accesorios de entrenamiento"]}
]'::jsonb, 1)
on conflict (state_key) do nothing;

drop policy if exists biotech_product_images_public_read on storage.objects;
create policy biotech_product_images_public_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'product-images');
drop policy if exists biotech_product_images_admin_insert on storage.objects;
create policy biotech_product_images_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and (select public.is_biotech_admin()));
drop policy if exists biotech_product_images_admin_update on storage.objects;
create policy biotech_product_images_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and (select public.is_biotech_admin()))
  with check (bucket_id = 'product-images' and (select public.is_biotech_admin()));
drop policy if exists biotech_product_images_admin_delete on storage.objects;
create policy biotech_product_images_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and (select public.is_biotech_admin()));

commit;

-- Create the first Auth user in Supabase before running this one-time bootstrap as the project owner:
-- insert into public.profiles (id, email, role)
-- select id, email, 'admin' from auth.users where lower(email) = lower('TU_CORREO_DE_ADMIN');
-- No browser client can insert a profile or assign itself the admin role.

