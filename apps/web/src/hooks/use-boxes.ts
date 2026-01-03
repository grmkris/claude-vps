"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { client, orpc } from "@/utils/orpc";

export function useBoxes() {
	return useQuery(orpc.box.list.queryOptions());
}

export function useBox(id: string) {
	return useQuery(orpc.box.byId.queryOptions({ id }));
}

export function useCreateBox() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { name: string; password: string }) =>
			client.box.create(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.box.list.queryOptions().queryKey,
			});
			toast.success("Box created!");
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "Failed to create box");
		},
	});
}

export function useDeployBox() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { id: string; password: string }) => client.box.deploy(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.box.list.queryOptions().queryKey,
			});
			toast.success("Deployment started!");
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "Failed to deploy");
		},
	});
}

export function useDeleteBox() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (id: string) => client.box.delete({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.box.list.queryOptions().queryKey,
			});
			toast.success("Box deleted!");
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "Failed to delete");
		},
	});
}

export function useBoxUrl(id: string) {
	return useQuery({
		...orpc.box.getUrl.queryOptions({ id }),
		enabled: !!id,
	});
}
