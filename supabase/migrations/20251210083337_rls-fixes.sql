-- helper to break recursion
create or replace function public.is_canvas_owner(canvas_uuid uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return exists (
    select 1 from public.canvases c
    where c.id = canvas_uuid and c.owner_id = auth.uid()
  );
end;
$$;

-- canvases policies
drop policy if exists "Shared users can view canvas" on public.canvases;
create policy "Shared users can view canvas" on public.canvases
  for select using (
    exists (
      select 1 from public.canvas_shares
      where canvas_id = canvases.id
        and (
          user_id = auth.uid()
          or email = (auth.jwt()->>'email')
        )
    )
    or is_public = true
  );

-- canvas_shares policies
drop policy if exists "Canvas owner can manage shares" on public.canvas_shares;
create policy "Canvas owner can manage shares" on public.canvas_shares
  for all using (public.is_canvas_owner(canvas_id));

drop policy if exists "Users can view their own shares" on public.canvas_shares;
create policy "Users can view their own shares" on public.canvas_shares
  for select using (
    user_id = auth.uid()
    or email = (auth.jwt()->>'email')
  );

-- helper used by other policies
create or replace function public.get_canvas_permission(canvas_uuid uuid)
returns permission_level
language plpgsql
security definer
set search_path = public, auth
as $$
declare perm permission_level;
begin
  if public.is_canvas_owner(canvas_uuid) then
    return 'owner';
  end if;
  select permission into perm
    from public.canvas_shares
   where canvas_id = canvas_uuid
     and (
       user_id = auth.uid()
       or email = (auth.jwt()->>'email')
     )
   limit 1;
  return perm;
end;
$$;