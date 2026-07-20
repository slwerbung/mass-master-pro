-- Vehicle layout corrections should work like Aufmaß location corrections
-- (threaded LocationChat between customer and employee). location_feedback
-- already has an author_type column; mirror it on vehicle_layout_feedback so
-- employee replies can be told apart from customer/guest messages.
alter table public.vehicle_layout_feedback
  add column if not exists author_type text not null default 'customer';

-- Existing rows were all customer-created (employees could previously only mark
-- them done, never reply), so the default already fits.
update public.vehicle_layout_feedback set author_type = 'customer' where author_type is null;
