import { // existing imports
    Trash2 // Add this import
} from 'lucide-react';
import { deleteProjectFromSupabase } from 'supabaseSync'; // Add this import
import { showToast } from 'path/to/toast/function'; // Adjust according to your toast function import path

async function deleteProject(projectId: string) {
    const confirmDelete = window.confirm('Are you sure you want to delete this project?');
    if (confirmDelete) {
        await deleteProjectFromSupabase(projectId); // Call the Supabase deletion
        await indexedDBStorage.deleteProject(projectId); // Delete from IndexedDB
        showToast('Project deleted successfully.'); // Show success toast
        reloadProjects(); // Function to reload projects goes here
    }
}

// Inside your card mapping section (around line 148-175), add the delete button:
{projects.map(project => (
    <div key={project.id}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h3>{project.title}</h3>
            <button onClick={() => deleteProject(project.id)}>
                <Trash2 /> {/* Your icon here */}
            </button>
        </div>
        {/* Other project details */}
    </div>
))}