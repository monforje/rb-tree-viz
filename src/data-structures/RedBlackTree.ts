// src/renderer/src/data-structures/RedBlackTree.ts
/**
 * Высокооптимизированное красно-черное дерево с управлением памятью
 * Включает pool объектов, оптимизации поиска, и элементы уровня C++
 */

export enum Color {
  RED = 0, // Используем числа вместо строк для скорости
  BLACK = 1,
}

export interface RBNode<T> {
  key: string;
  keyHash: number; // Кэшированный хеш для быстрого сравнения
  value: T;
  color: Color;
  left: RBNode<T>;
  right: RBNode<T>;
  parent: RBNode<T>;
  // Дополнительные поля для оптимизации
  height?: number; // Кэшированная высота поддерева
}

// Пул объектов для узлов дерева (управление памятью как в C++)
class RBNodePool<T> {
  private pool: RBNode<T>[] = [];
  private maxPoolSize: number = 2000;
  private readonly NIL: RBNode<T>;

  constructor(nil: RBNode<T>) {
    this.NIL = nil;
  }

  acquire(key: string, keyHash: number, value: T): RBNode<T> {
    const node = this.pool.pop();
    if (node) {
      // Переиспользуем существующий узел
      node.key = key;
      node.keyHash = keyHash;
      node.value = value;
      node.color = Color.RED;
      node.left = this.NIL;
      node.right = this.NIL;
      node.parent = this.NIL;
      node.height = 1;
      return node;
    }

    // Создаем новый узел только если пул пуст
    return {
      key,
      keyHash,
      value,
      color: Color.RED,
      left: this.NIL,
      right: this.NIL,
      parent: this.NIL,
      height: 1,
    };
  }

  release(node: RBNode<T>): void {
    if (this.pool.length < this.maxPoolSize && node !== this.NIL) {
      // Очищаем ссылки для GC
      node.key = "";
      node.keyHash = 0;
      node.value = null as any;
      node.left = this.NIL;
      node.right = this.NIL;
      node.parent = this.NIL;
      this.pool.push(node);
    }
  }

  clear(): void {
    this.pool.length = 0;
  }

  getPoolSize(): number {
    return this.pool.length;
  }
}

export class RedBlackTree<T> {
  private root: RBNode<T>;
  private readonly NIL: RBNode<T>;
  private size: number;
  private readonly nodePool: RBNodePool<T>;

  // Оптимизации производительности
  private readonly hashSeed: number;
  private rotationCount: number = 0;
  private searchCount: number = 0;
  private maxDepthReached: number = 0;

  constructor() {
    // Создаем optimized sentinel узел
    this.NIL = {
      key: "",
      keyHash: 0,
      value: null as any,
      color: Color.BLACK,
      left: null as any,
      right: null as any,
      parent: null as any,
      height: 0,
    };

    // Инициализируем циклические ссылки для NIL
    this.NIL.left = this.NIL;
    this.NIL.right = this.NIL;
    this.NIL.parent = this.NIL;

    this.root = this.NIL;
    this.size = 0;
    this.nodePool = new RBNodePool<T>(this.NIL);
    this.hashSeed = Math.floor(Math.random() * 0x7fffffff);
  }

  /**
   * Быстрая хеш-функция для строковых ключей
   */
  private fastHash(key: string): number {
    let hash = 0x811c9dc5 ^ this.hashSeed;

    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }

    return hash;
  }

  /**
   * Оптимизированное сравнение ключей
   */
  private compareKeys(
    key1: string,
    hash1: number,
    key2: string,
    hash2: number
  ): number {
    // Сначала сравниваем хеши (быстрее)
    if (hash1 !== hash2) {
      return hash1 < hash2 ? -1 : 1;
    }

    // Если хеши равны, сравниваем строки
    return key1 < key2 ? -1 : key1 > key2 ? 1 : 0;
  }

  /**
   * Обновление кэшированной высоты узла
   */
  private updateHeight(node: RBNode<T>): void {
    if (node !== this.NIL) {
      const leftHeight = node.left.height || 0;
      const rightHeight = node.right.height || 0;
      node.height = 1 + Math.max(leftHeight, rightHeight);
    }
  }

  /**
   * Оптимизированный левый поворот
   */
  private leftRotate(x: RBNode<T>): void {
    this.rotationCount++;

    const y = x.right;
    x.right = y.left;

    if (y.left !== this.NIL) {
      y.left.parent = x;
    }

    y.parent = x.parent;

    if (x.parent === this.NIL) {
      this.root = y;
    } else if (x === x.parent.left) {
      x.parent.left = y;
    } else {
      x.parent.right = y;
    }

    y.left = x;
    x.parent = y;

    // Обновляем высоты
    this.updateHeight(x);
    this.updateHeight(y);
  }

  /**
   * Оптимизированный правый поворот
   */
  private rightRotate(y: RBNode<T>): void {
    this.rotationCount++;

    const x = y.left;
    y.left = x.right;

    if (x.right !== this.NIL) {
      x.right.parent = y;
    }

    x.parent = y.parent;

    if (y.parent === this.NIL) {
      this.root = x;
    } else if (y === y.parent.left) {
      y.parent.left = x;
    } else {
      y.parent.right = x;
    }

    x.right = y;
    y.parent = x;

    // Обновляем высоты
    this.updateHeight(y);
    this.updateHeight(x);
  }

  /**
   * Высокопроизводительная вставка
   */
  public insert(key: string, value: T): void {
    if (key === null || key === undefined) {
      throw new Error("Key cannot be null or undefined");
    }

    const keyHash = this.fastHash(key);
    let parent = this.NIL;
    let current = this.root;
    let depth = 0;

    // Итеративный поиск позиции для вставки
    while (current !== this.NIL) {
      parent = current;
      depth++;

      const cmp = this.compareKeys(key, keyHash, current.key, current.keyHash);

      if (cmp < 0) {
        current = current.left;
      } else if (cmp > 0) {
        current = current.right;
      } else {
        // Ключ уже существует, обновляем значение
        current.value = value;
        return;
      }
    }

    // Создаем новый узел из пула
    const newNode = this.nodePool.acquire(key, keyHash, value);
    newNode.parent = parent;

    if (parent === this.NIL) {
      this.root = newNode;
    } else {
      const cmp = this.compareKeys(key, keyHash, parent.key, parent.keyHash);
      if (cmp < 0) {
        parent.left = newNode;
      } else {
        parent.right = newNode;
      }
    }

    this.size++;
    this.maxDepthReached = Math.max(this.maxDepthReached, depth);

    // Восстанавливаем свойства красно-черного дерева
    this.insertFixup(newNode);

    // Обновляем высоты до корня
    this.updateHeightsToRoot(newNode);
  }

  /**
   * Обновление высот до корня
   */
  private updateHeightsToRoot(node: RBNode<T>): void {
    let current = node;
    while (current !== this.NIL) {
      this.updateHeight(current);
      current = current.parent;
    }
  }

  /**
   * Оптимизированный insertFixup
   */
  private insertFixup(node: RBNode<T>): void {
    while (node.parent.color === Color.RED) {
      if (node.parent === node.parent.parent.left) {
        const uncle = node.parent.parent.right;

        if (uncle.color === Color.RED) {
          // Случай 1: дядя красный
          node.parent.color = Color.BLACK;
          uncle.color = Color.BLACK;
          node.parent.parent.color = Color.RED;
          node = node.parent.parent;
        } else {
          if (node === node.parent.right) {
            // Случай 2: дядя черный, node - правый потомок
            node = node.parent;
            this.leftRotate(node);
          }
          // Случай 3: дядя черный, node - левый потомок
          node.parent.color = Color.BLACK;
          node.parent.parent.color = Color.RED;
          this.rightRotate(node.parent.parent);
        }
      } else {
        // Симметричные случаи
        const uncle = node.parent.parent.left;

        if (uncle.color === Color.RED) {
          node.parent.color = Color.BLACK;
          uncle.color = Color.BLACK;
          node.parent.parent.color = Color.RED;
          node = node.parent.parent;
        } else {
          if (node === node.parent.left) {
            node = node.parent;
            this.rightRotate(node);
          }
          node.parent.color = Color.BLACK;
          node.parent.parent.color = Color.RED;
          this.leftRotate(node.parent.parent);
        }
      }
    }

    this.root.color = Color.BLACK;
  }

  /**
   * Высокопроизводительный поиск с ранним выходом
   */
  public search(key: string): T | null {
    if (key === null || key === undefined) {
      return null;
    }

    this.searchCount++;
    const keyHash = this.fastHash(key);
    let current = this.root;
    let depth = 0;

    while (current !== this.NIL) {
      depth++;
      const cmp = this.compareKeys(key, keyHash, current.key, current.keyHash);

      if (cmp === 0) {
        this.maxDepthReached = Math.max(this.maxDepthReached, depth);
        return current.value;
      } else if (cmp < 0) {
        current = current.left;
      } else {
        current = current.right;
      }
    }

    this.maxDepthReached = Math.max(this.maxDepthReached, depth);
    return null;
  }

  /**
   * Быстрая проверка существования ключа
   */
  public contains(key: string): boolean {
    return this.search(key) !== null;
  }

  /**
   * Оптимизированное удаление с возвратом узлов в пул
   */
  public delete(key: string): boolean {
    const nodeToDelete = this.findNode(key);
    if (nodeToDelete === this.NIL) {
      return false;
    }

    this.deleteNode(nodeToDelete);
    this.size--;
    return true;
  }

  /**
   * Внутренний поиск узла
   */
  private findNode(key: string): RBNode<T> {
    const keyHash = this.fastHash(key);
    let current = this.root;

    while (current !== this.NIL) {
      const cmp = this.compareKeys(key, keyHash, current.key, current.keyHash);

      if (cmp === 0) {
        return current;
      } else if (cmp < 0) {
        current = current.left;
      } else {
        current = current.right;
      }
    }

    return this.NIL;
  }

  /**
   * Оптимизированное удаление узла
   */
  private deleteNode(z: RBNode<T>): void {
    let y = z;
    let yOriginalColor = y.color;
    let x: RBNode<T>;

    if (z.left === this.NIL) {
      x = z.right;
      this.transplant(z, z.right);
    } else if (z.right === this.NIL) {
      x = z.left;
      this.transplant(z, z.left);
    } else {
      y = this.minimum(z.right);
      yOriginalColor = y.color;
      x = y.right;

      if (y.parent === z) {
        x.parent = y;
      } else {
        this.transplant(y, y.right);
        y.right = z.right;
        y.right.parent = y;
      }

      this.transplant(z, y);
      y.left = z.left;
      y.left.parent = y;
      y.color = z.color;
      this.updateHeight(y);
    }

    // Возвращаем удаленный узел в пул
    this.nodePool.release(z);

    if (yOriginalColor === Color.BLACK) {
      this.deleteFixup(x);
    }

    // Обновляем высоты
    if (x !== this.NIL) {
      this.updateHeightsToRoot(x);
    }
  }

  /**
   * Операции для совместимости и дополнительной функциональности
   */
  private minimum(node: RBNode<T>): RBNode<T> {
    while (node.left !== this.NIL) {
      node = node.left;
    }
    return node;
  }

  private transplant(u: RBNode<T>, v: RBNode<T>): void {
    if (u.parent === this.NIL) {
      this.root = v;
    } else if (u === u.parent.left) {
      u.parent.left = v;
    } else {
      u.parent.right = v;
    }
    v.parent = u.parent;
  }

  private deleteFixup(x: RBNode<T>): void {
    while (x !== this.root && x.color === Color.BLACK) {
      if (x === x.parent.left) {
        let w = x.parent.right;

        if (w.color === Color.RED) {
          w.color = Color.BLACK;
          x.parent.color = Color.RED;
          this.leftRotate(x.parent);
          w = x.parent.right;
        }

        if (w.left.color === Color.BLACK && w.right.color === Color.BLACK) {
          w.color = Color.RED;
          x = x.parent;
        } else {
          if (w.right.color === Color.BLACK) {
            w.left.color = Color.BLACK;
            w.color = Color.RED;
            this.rightRotate(w);
            w = x.parent.right;
          }

          w.color = x.parent.color;
          x.parent.color = Color.BLACK;
          w.right.color = Color.BLACK;
          this.leftRotate(x.parent);
          x = this.root;
        }
      } else {
        let w = x.parent.left;

        if (w.color === Color.RED) {
          w.color = Color.BLACK;
          x.parent.color = Color.RED;
          this.rightRotate(x.parent);
          w = x.parent.left;
        }

        if (w.right.color === Color.BLACK && w.left.color === Color.BLACK) {
          w.color = Color.RED;
          x = x.parent;
        } else {
          if (w.left.color === Color.BLACK) {
            w.right.color = Color.BLACK;
            w.color = Color.RED;
            this.leftRotate(w);
            w = x.parent.left;
          }

          w.color = x.parent.color;
          x.parent.color = Color.BLACK;
          w.left.color = Color.BLACK;
          this.rightRotate(x.parent);
          x = this.root;
        }
      }
    }

    x.color = Color.BLACK;
  }

  /**
   * Быстрая очистка с возвратом всех узлов в пул
   */
  public clear(): void {
    this.clearSubtree(this.root);
    this.root = this.NIL;
    this.size = 0;
    this.rotationCount = 0;
    this.searchCount = 0;
    this.maxDepthReached = 0;
  }

  /**
   * Рекурсивная очистка поддерева
   */
  private clearSubtree(node: RBNode<T>): void {
    if (node !== this.NIL) {
      this.clearSubtree(node.left);
      this.clearSubtree(node.right);
      this.nodePool.release(node);
    }
  }

  /**
   * Принудительная очистка памяти (аналог explicit deallocation в C++)
   */
  public deallocate(): void {
    this.clear();
    this.nodePool.clear();
  }

  /**
   * Получение высоты дерева (оптимизированная версия)
   */
  public getHeight(): number {
    return this.root.height || 0;
  }

  /**
   * Быстрое вычисление черной высоты
   */
  public getBlackHeight(): number {
    if (this.root === this.NIL) return 0;

    let blackHeight = 0;
    let current = this.root;

    // Идем по левому краю до листа
    while (current !== this.NIL) {
      if (current.color === Color.BLACK) {
        blackHeight++;
      }
      current = current.left;
    }

    return blackHeight;
  }

  /**
   * Оптимизированное получение всех значений
   */
  public values(): T[] {
    const result: T[] = new Array(this.size);
    let index = 0;

    this.inOrderTraversal(this.root, (value) => {
      result[index++] = value;
    });

    return result;
  }

  /**
   * Оптимизированное получение всех ключей
   */
  public keys(): string[] {
    const result: string[] = new Array(this.size);
    let index = 0;

    this.inOrderKeys(this.root, (key) => {
      result[index++] = key;
    });

    return result;
  }

  /**
   * Быстрый симметричный обход
   */
  private inOrderTraversal(node: RBNode<T>, visit: (value: T) => void): void {
    if (node !== this.NIL) {
      this.inOrderTraversal(node.left, visit);
      visit(node.value);
      this.inOrderTraversal(node.right, visit);
    }
  }

  /**
   * Быстрый обход ключей
   */
  private inOrderKeys(node: RBNode<T>, visit: (key: string) => void): void {
    if (node !== this.NIL) {
      this.inOrderKeys(node.left, visit);
      visit(node.key);
      this.inOrderKeys(node.right, visit);
    }
  }

  /**
   * Получение минимального и максимального значений
   */
  public getMin(): T | null {
    if (this.root === this.NIL) return null;
    return this.minimum(this.root).value;
  }

  public getMax(): T | null {
    if (this.root === this.NIL) return null;

    let current = this.root;
    while (current.right !== this.NIL) {
      current = current.right;
    }
    return current.value;
  }

  /**
   * Быстрая валидация дерева (оптимизированная)
   */
  public isValid(): boolean {
    if (this.root === this.NIL) return true;
    if (this.root.color !== Color.BLACK) return false;

    return this.validateSubtree(this.root).isValid;
  }

  private validateSubtree(node: RBNode<T>): {
    isValid: boolean;
    blackHeight: number;
  } {
    if (node === this.NIL) {
      return { isValid: true, blackHeight: 0 };
    }

    const leftResult = this.validateSubtree(node.left);
    if (!leftResult.isValid) return { isValid: false, blackHeight: 0 };

    const rightResult = this.validateSubtree(node.right);
    if (!rightResult.isValid) return { isValid: false, blackHeight: 0 };

    // Проверка черной высоты
    if (leftResult.blackHeight !== rightResult.blackHeight) {
      return { isValid: false, blackHeight: 0 };
    }

    // Проверка красных узлов
    if (node.color === Color.RED) {
      if (node.left.color === Color.RED || node.right.color === Color.RED) {
        return { isValid: false, blackHeight: 0 };
      }
    }

    const blackIncrement = node.color === Color.BLACK ? 1 : 0;
    return {
      isValid: true,
      blackHeight: leftResult.blackHeight + blackIncrement,
    };
  }

  /**
   * Расширенная статистика производительности
   */
  public getPerformanceStats(): {
    size: number;
    height: number;
    blackHeight: number;
    isValid: boolean;
    rotationCount: number;
    searchCount: number;
    maxDepthReached: number;
    avgSearchDepth: number;
    memoryEfficiency: number;
    poolSize: number;
    balanceFactor: number;
  } {
    const theoreticalOptimalHeight =
      this.size > 0 ? Math.ceil(Math.log2(this.size + 1)) : 0;
    const actualHeight = this.getHeight();

    return {
      size: this.size,
      height: actualHeight,
      blackHeight: this.getBlackHeight(),
      isValid: this.isValid(),
      rotationCount: this.rotationCount,
      searchCount: this.searchCount,
      maxDepthReached: this.maxDepthReached,
      avgSearchDepth:
        this.searchCount > 0 ? this.maxDepthReached / this.searchCount : 0,
      memoryEfficiency:
        this.nodePool.getPoolSize() / (this.size + this.nodePool.getPoolSize()),
      poolSize: this.nodePool.getPoolSize(),
      balanceFactor:
        theoreticalOptimalHeight > 0
          ? theoreticalOptimalHeight / actualHeight
          : 1,
    };
  }

  /**
   * Предварительное выделение памяти в пуле
   */
  public reserve(expectedSize: number): void {
    // Предварительно создаем узлы в пуле для быстрых вставок
    const nodesToPreallocate = Math.min(expectedSize, 1000);
    for (let i = 0; i < nodesToPreallocate; i++) {
      const tempNode = this.nodePool.acquire("", 0, null as any);
      this.nodePool.release(tempNode);
    }
  }

  /**
   * Высокопроизводительный итератор
   */
  public *entries(): IterableIterator<[string, T]> {
    yield* this.inOrderEntries(this.root);
  }

  private *inOrderEntries(node: RBNode<T>): IterableIterator<[string, T]> {
    if (node !== this.NIL) {
      yield* this.inOrderEntries(node.left);
      yield [node.key, node.value];
      yield* this.inOrderEntries(node.right);
    }
  }

  /**
   * Массовая вставка с оптимизацией
   */
  public bulkInsert(entries: Array<[string, T]>): void {
    // Предварительно выделяем память
    this.reserve(entries.length);

    // Сортируем записи для оптимального построения дерева
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    // Вставляем отсортированные данные
    for (const [key, value] of entries) {
      this.insert(key, value);
    }
  }

  // Геттеры для совместимости
  public getSize(): number {
    return this.size;
  }
  public isEmpty(): boolean {
    return this.size === 0;
  }

  // Синонимы для совместимости
  public has(key: string): boolean {
    return this.contains(key);
  }
  public getAllKeys(): string[] {
    return this.keys();
  }
  public getAllValues(): T[] {
    return this.values();
  }
  public getTreeStatistics() {
    return this.getPerformanceStats();
  }
}
