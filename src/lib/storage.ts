import { Project } from "@/types/project";
import { parseStoredDate } from "@/lib/dateUtils";

const STORAGE_KEY = "aufmass_projects";

export const storage = {
  getProjects(): Project[] {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    
    const projects = JSON.parse(data);
    return projects.map((p: any) => ({
      ...p,
      createdAt: parseStoredDate(p.createdAt),
      updatedAt: new Date(p.updatedAt),
      locations: p.locations.map((l: any) => ({
        ...l,
        createdAt: parseStoredDate(l.createdAt),
      })),
    }));
  },

  getProject(id: string): Project | null {
    const projects = this.getProjects();
    return projects.find((p) => p.id === id) || null;
  },

  saveProject(project: Project): void {
    const projects = this.getProjects();
    const index = projects.findIndex((p) => p.id === project.id);
    
    if (index >= 0) {
      projects[index] = { ...project, updatedAt: new Date() };
    } else {
      projects.push(project);
    }
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        throw new Error("QUOTA_EXCEEDED");
      }
      throw error;
    }
  },

  deleteProject(id: string): void {
    const projects = this.getProjects();
    const filtered = projects.filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  },
};
