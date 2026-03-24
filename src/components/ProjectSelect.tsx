import { useStore } from '../store/store';

interface ProjectSelectProps {
  value: string | null;
  onChange: (projectId: string | null) => void;
  placeholder?: string;
  className?: string;
}

export function ProjectSelect({ value, onChange, placeholder, className }: ProjectSelectProps) {
  const projects = useStore((s) => s.projects);

  return (
    <select
      className={`project-select${className ? ` ${className}` : ''}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.currentTarget.value || null)}
    >
      {placeholder && (
        <option value="" disabled hidden>
          {placeholder}
        </option>
      )}
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name} — {project.path}
        </option>
      ))}
    </select>
  );
}
