// Other existing content of supabaseSync.ts

async function deleteProjectFromSupabase(projectId) {
    // Delete project from Supabase
    await supabase
        .from('projects')
        .delete()
        .eq('id', projectId);

    // Delete locations related to the project
    await supabase
        .from('locations')
        .delete()
        .eq('project_id', projectId);

    // Delete location images related to the locations
    await supabase
        .from('location_images')
        .delete()
        .in('location_id', await supabase
            .from('locations')
            .select('id')
            .eq('project_id', projectId)
            .then(({ data }) => data.map(location => location.id)));

    // Delete location PDFs related to the locations
    await supabase
        .from('location_pdfs')
        .delete()
        .in('location_id', await supabase
            .from('locations')
            .select('id')
            .eq('project_id', projectId)
            .then(({ data }) => data.map(location => location.id)));

    // Delete location approvals related to the locations
    await supabase
        .from('location_approvals')
        .delete()
        .in('location_id', await supabase
            .from('locations')
            .select('id')
            .eq('project_id', projectId)
            .then(({ data }) => data.map(location => location.id)));

    // Optional: Delete from IndexedDB if necessary
    // Replace this comment with IndexedDB deletion logic if applicable
}

// Place to call deleteProjectFromSupabase function as necessary
