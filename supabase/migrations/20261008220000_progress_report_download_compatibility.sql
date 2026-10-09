-- Some Storage versions omit/change the operation label on a direct download.
-- Storage also sets request.method and request.path from its HTTP request.
-- Accept only a GET for this exact private object as the compatibility path.
-- Authenticated coach/current-parent checks remain mandatory in either case.
alter policy progress_report_objects_read_guard on storage.objects
using (
  case when bucket_id = 'athlete-progress-reports' then
    case when current_user = 'authenticated' then
      private.can_read_progress_file(name)
      and (
        current_setting('storage.operation', true)
          in ('object.get_authenticated', 'storage.object.get_authenticated')
        or (
          current_setting('request.method', true) = 'GET'
          and split_part(current_setting('request.path', true), '?', 1) in (
            '/object/athlete-progress-reports/' || name,
            '/object/authenticated/athlete-progress-reports/' || name,
            '/storage/v1/object/athlete-progress-reports/' || name,
            '/storage/v1/object/authenticated/athlete-progress-reports/' || name
          )
        )
      )
    else false end
  else true end
);
